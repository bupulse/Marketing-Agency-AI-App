import { decrypt, encrypt } from "@/lib/crypto";
import { siteUrl } from "@/lib/auth/site-url";
import { base64Url, codeChallenge, newCodeVerifier, randomToken, sameString } from "@/lib/canva/pkce";
import type { Network, OAuthResult } from "./types";

// Shared connect flow for every network: a sealed, expiring "pending login" cookie carries the state,
// the PKCE verifier, the user, the network, the variant and a safe `next`. The cookie is AES-GCM sealed
// (see lib/crypto.ts), so the browser can neither read the verifier nor forge or move it to another user.

export { sameString };

export const STATE_COOKIE = "bp_social_oauth";
export const PENDING_COOKIE = "bp_social_pending";
/** The callback may send the user to any safe `next`, so the pending-accounts cookie is not tied to one path (it is encrypted, httpOnly and lives 10 minutes). */
export const PENDING_PATH = "/";
const STATE_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
// Browsers keep about 4 KB per cookie; a sealed pending result is split over a few cookies.
const CHUNK = 3400;
const MAX_CHUNKS = 4;

/** Connection variants a network offers through OAuth. The first is the default. */
export const VARIANTS: Partial<Record<Network, readonly string[]>> = {
  instagram: ["instagram", "facebook"],
  linkedin: ["member", "organization"],
};

export function isValidVariant(network: Network, variant: string | null | undefined): boolean {
  const allowed = VARIANTS[network];
  if (!variant) return true;
  return !!allowed && allowed.includes(variant);
}

export function redirectUri(network: Network): string {
  return `${siteUrl()}/api/social/${network}/callback`;
}

export type SocialState = {
  state: string;
  verifier: string;
  userId: string;
  network: Network;
  variant?: string;
  next: string;
  expiresAt: number;
};

export const newState = () => randomToken(24);
export { codeChallenge, newCodeVerifier };

export async function sealState(data: Omit<SocialState, "expiresAt">, now = Date.now()): Promise<string> {
  return encrypt(JSON.stringify({ ...data, expiresAt: now + STATE_TTL_MS } satisfies SocialState));
}

export type StateResult = { ok: true; data: SocialState } | { ok: false; reason: "missing" | "expired" | "invalid" };

/** Opens the pending login. "invalid" covers forged cookies and cookies that belong to another user or network. */
export async function openState(sealed: string | undefined, userId: string, network: Network, now = Date.now()): Promise<StateResult> {
  if (!sealed) return { ok: false, reason: "missing" };
  try {
    const data = JSON.parse(await decrypt(sealed)) as SocialState;
    if (typeof data.state !== "string" || typeof data.verifier !== "string" || data.userId !== userId || data.network !== network) {
      return { ok: false, reason: "invalid" };
    }
    if (data.expiresAt < now) return { ok: false, reason: "expired" };
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function cookieOptions(path: string, maxAge = 600) {
  return { httpOnly: true, secure: siteUrl().startsWith("https://"), sameSite: "lax" as const, path, maxAge };
}

// ---- Pending accounts: an OAuth result waiting for the user to choose accounts ----

type PendingPayload = {
  userId: string;
  network: Network;
  variant?: string;
  expiresAt: number;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  scopes: string[];
  accounts: OAuthResult["accounts"];
  accountTokens?: Record<string, { accessToken: string; expiresAt?: number }>;
};

export type PendingOAuth = { network: Network; variant?: string; result: OAuthResult };

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function serialize(userId: string, network: Network, variant: string | undefined, r: OAuthResult, now: number): PendingPayload {
  return {
    userId,
    network,
    variant,
    expiresAt: now + PENDING_TTL_MS,
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    tokenExpiresAt: r.expiresAt?.getTime(),
    scopes: r.scopes,
    accounts: r.accounts,
    accountTokens: r.accountTokens
      ? Object.fromEntries(Object.entries(r.accountTokens).map(([id, t]) => [id, { accessToken: t.accessToken, expiresAt: t.expiresAt?.getTime() }]))
      : undefined,
  };
}

/**
 * Seals an OAuth result into cookie chunks (name -> value). Accounts that do not fit in the cookie budget
 * are dropped (avatar URLs go first, they are the longest part and can be rebuilt by the network).
 */
export async function sealPending(userId: string, network: Network, variant: string | undefined, result: OAuthResult, now = Date.now()): Promise<Record<string, string>> {
  const bare = { ...result, accounts: result.accounts.map((a) => ({ ...a, avatarUrl: undefined })) };
  // Try everything first, then without avatars, then fewer accounts.
  const attempts: OAuthResult[] = [result, bare];
  for (let keep = bare.accounts.length - 1; keep >= 1; keep -= 1) attempts.push({ ...bare, accounts: bare.accounts.slice(0, keep) });
  for (const attempt of attempts) {
    const tokens = result.accountTokens;
    const accountTokens = tokens
      ? Object.fromEntries(attempt.accounts.filter((a) => tokens[a.externalAccountId]).map((a) => [a.externalAccountId, tokens[a.externalAccountId]]))
      : undefined;
    const payload = serialize(userId, network, variant, { ...attempt, accountTokens }, now);
    const encrypted = await encrypt(base64Url(await deflate(JSON.stringify(payload))));
    if (encrypted.length > CHUNK * MAX_CHUNKS) continue;
    const out: Record<string, string> = {};
    for (let i = 0; i * CHUNK < encrypted.length; i += 1) out[`${PENDING_COOKIE}_${i}`] = encrypted.slice(i * CHUNK, (i + 1) * CHUNK);
    return out;
  }
  throw new Error("Too many accounts to hold in a cookie");
}

export const pendingCookieNames = () => Array.from({ length: MAX_CHUNKS }, (_, i) => `${PENDING_COOKIE}_${i}`);

/** The pending result for this user, or null when missing, forged, expired or someone else's. */
export async function openPending(read: (name: string) => string | undefined, userId: string, now = Date.now()): Promise<PendingOAuth | null> {
  const parts: string[] = [];
  for (const name of pendingCookieNames()) {
    const value = read(name);
    if (!value) break;
    parts.push(value);
  }
  if (!parts.length) return null;
  try {
    const sealed = await decrypt(parts.join(""));
    const bytes = Uint8Array.from(atob(sealed.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const p = JSON.parse(await inflate(bytes)) as PendingPayload;
    if (p.userId !== userId || p.expiresAt < now) return null;
    return {
      network: p.network,
      variant: p.variant,
      result: {
        accessToken: p.accessToken,
        refreshToken: p.refreshToken,
        expiresAt: p.tokenExpiresAt ? new Date(p.tokenExpiresAt) : undefined,
        scopes: p.scopes,
        accounts: p.accounts,
        accountTokens: p.accountTokens
          ? Object.fromEntries(Object.entries(p.accountTokens).map(([id, t]) => [id, { accessToken: t.accessToken, expiresAt: t.expiresAt ? new Date(t.expiresAt) : undefined }]))
          : undefined,
      },
    };
  } catch {
    return null;
  }
}

export { CONNECT_ERRORS, type ConnectErrorCode } from "./connect-errors";
