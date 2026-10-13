import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";

// Paddle's credentials (docs/BILLING.md, "Connecting Paddle"): set in Admin -> Settings -> Card payments (Paddle) and
// kept in AdminSetting "billing.paddle", each secret encrypted with ENCRYPTION_KEY (lib/crypto.ts) like the Google
// Calendar token, never shown again (only its last 4 characters). The environment variables stay as the fallback:
// per value, the saved setting wins, the variable is used when nothing is saved. The environment comes with the saved
// API key (a sandbox key and a live key are different accounts); without one, PADDLE_ENVIRONMENT.

export const PADDLE_SETTING_KEY = "billing.paddle";
export type PaddleEnvironment = "sandbox" | "production";
export type PaddleSecretName = "apiKey" | "clientToken" | "webhookSecret";
export const PADDLE_SECRETS: PaddleSecretName[] = ["apiKey", "clientToken", "webhookSecret"];
const ENV_NAME: Record<PaddleSecretName, string> = { apiKey: "PADDLE_API_KEY", clientToken: "PADDLE_CLIENT_TOKEN", webhookSecret: "PADDLE_WEBHOOK_SECRET" };
/** Audit names of the values: neutral words, because the audit log redacts anything called a key, token or secret. */
const AUDIT_NAME: Record<PaddleSecretName, string> = { apiKey: "api", clientToken: "client", webhookSecret: "webhook" };
const endings = (s: Stored) => Object.fromEntries(PADDLE_SECRETS.map((n) => [AUDIT_NAME[n], s[n]?.last4 ?? null]));

export const SECRET_LABEL: Record<PaddleSecretName, string> = { apiKey: "API key", clientToken: "Client-side token", webhookSecret: "Webhook secret" };

/** What the row holds: encrypted values and their last 4 characters (for the settings page and the audit). */
type Stored = { environment?: PaddleEnvironment } & Partial<Record<PaddleSecretName, { enc: string; last4: string } | null>> & { updatedAt?: string };

export type PaddleConfig = {
  environment: PaddleEnvironment;
  apiKey: string | null;
  clientToken: string | null;
  webhookSecret: string | null;
  /** Where each value came from: the saved setting, the environment variable, or nowhere. */
  source: Record<PaddleSecretName | "environment", "settings" | "env" | null>;
  /** Last 4 characters of each value in use (never the value itself). */
  last4: Record<PaddleSecretName, string | null>;
};

// Only the saved values are cached (30 s, per isolate; the writers clear it). The environment variables are read on
// every call, so the fallback always reflects them.
const TTL_MS = 30_000;
type Saved = Partial<Record<PaddleSecretName, string>> & { environment?: PaddleEnvironment };
let cached: { at: number; value: Saved } | null = null;

export function clearPaddleConfigCache() {
  cached = null;
}

const tail = (v: string | null | undefined) => (v ? v.slice(-4) : null);
const envEnvironment = (): PaddleEnvironment => (process.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox");

function cleanStored(value: unknown): Stored {
  return value && typeof value === "object" ? (value as Stored) : {};
}

async function readStored(db: Pick<typeof prisma, "adminSetting"> = prisma): Promise<Stored> {
  const row = await db.adminSetting.findUnique({ where: { key: PADDLE_SETTING_KEY } });
  return cleanStored(row?.value);
}

/** The saved values, decrypted. A database or decryption error counts as nothing saved (the variables then apply). */
async function savedValues(force: boolean): Promise<Saved> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value: Saved = {};
  try {
    const stored = await readStored();
    for (const name of PADDLE_SECRETS) {
      const enc = stored[name]?.enc;
      const plain = enc ? await decrypt(enc).catch(() => null) : null;
      if (plain) value[name] = plain;
    }
    if (stored.environment === "sandbox" || stored.environment === "production") value.environment = stored.environment;
  } catch {
    value = cached?.value ?? {};
  }
  cached = { at: Date.now(), value };
  return value;
}

/** The credentials in use: per value, the saved setting, else the PADDLE_* environment variable. */
export async function getPaddleConfig(opts: { force?: boolean } = {}): Promise<PaddleConfig> {
  const saved = await savedValues(Boolean(opts.force));
  const value: PaddleConfig = {
    environment: envEnvironment(),
    apiKey: null,
    clientToken: null,
    webhookSecret: null,
    source: { apiKey: null, clientToken: null, webhookSecret: null, environment: "env" },
    last4: { apiKey: null, clientToken: null, webhookSecret: null },
  };
  for (const name of PADDLE_SECRETS) {
    if (saved[name]) {
      value[name] = saved[name] as string;
      value.source[name] = "settings";
    } else if (process.env[ENV_NAME[name]]) {
      value[name] = process.env[ENV_NAME[name]] as string;
      value.source[name] = "env";
    }
    value.last4[name] = tail(value[name]);
  }
  // The environment goes with the saved API key (a sandbox key and a live key are different accounts).
  if (value.source.apiKey === "settings" && saved.environment) {
    value.environment = saved.environment;
    value.source.environment = "settings";
  }
  return value;
}

/** All three values are there: checkout can open and webhooks can be verified. */
export function paddleCredentialsComplete(c: Pick<PaddleConfig, PaddleSecretName>): boolean {
  return Boolean(c.apiKey && c.clientToken && c.webhookSecret);
}

/** Which values are missing, in words ("API key, webhook secret"), or null. */
export function missingPaddleValues(c: Pick<PaddleConfig, PaddleSecretName>): string | null {
  const missing = PADDLE_SECRETS.filter((n) => !c[n]).map((n) => SECRET_LABEL[n].toLowerCase());
  return missing.length ? missing.join(", ") : null;
}

export function paddleApiBase(environment: PaddleEnvironment): string {
  return environment === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

/**
 * Why a value cannot be saved, or null. Paddle's formats: API keys start "pdl_sdbx_apikey_" (sandbox) or
 * "pdl_live_apikey_" (live), client-side tokens "test_" or "live_", notification secrets "pdl_ntfset_". A value for the
 * other environment is refused (the most common mix-up).
 */
export function paddleValueProblem(name: PaddleSecretName, value: string, environment: PaddleEnvironment): string | null {
  if (/\s/.test(value) || value.length < 12 || value.length > 300) return `That ${SECRET_LABEL[name].toLowerCase()} does not look right (no spaces, 12 to 300 characters).`;
  const live = environment === "production";
  if (name === "apiKey") {
    if (!value.startsWith("pdl_")) return "A Paddle API key starts with pdl_ (Paddle > Developer tools > Authentication).";
    if (/^pdl_(sdbx|live)_/.test(value) && value.startsWith(live ? "pdl_sdbx_" : "pdl_live_")) return `That is a ${live ? "sandbox" : "live"} API key, but the environment is ${live ? "live" : "sandbox"}.`;
  }
  if (name === "clientToken") {
    if (!/^(test|live)_/.test(value)) return "A client-side token starts with test_ (sandbox) or live_ (live).";
    if (value.startsWith(live ? "test_" : "live_")) return `That is a ${live ? "sandbox" : "live"} client-side token, but the environment is ${live ? "live" : "sandbox"}.`;
  }
  return null;
}

export type PaddleSettingsInput = { environment?: string; apiKey?: string; clientToken?: string; webhookSecret?: string };

/**
 * Saves what the admin typed: the environment and any secret given (an empty field keeps the saved one). Each value is
 * checked, encrypted, and audited by its last 4 characters only. Console only (AAL2, adminAction), never the API.
 * Switching environment needs a new API key and client token (sandbox and live are different accounts).
 */
export async function savePaddleSettings(ctx: AdminContext, input: PaddleSettingsInput): Promise<{ environment: PaddleEnvironment; changed: PaddleSecretName[] }> {
  if (ctx.viaApi) throw new AdminError("forbidden", "Paddle is connected in the admin console only.");
  const environment: PaddleEnvironment = input.environment === "production" ? "production" : "sandbox";
  const typed = Object.fromEntries(PADDLE_SECRETS.map((n) => [n, (input[n] ?? "").trim()])) as Record<PaddleSecretName, string>;
  for (const name of PADDLE_SECRETS) {
    const problem = typed[name] ? paddleValueProblem(name, typed[name], environment) : null;
    if (problem) throw new AdminError("invalid", problem);
  }
  const encrypted = Object.fromEntries(await Promise.all(PADDLE_SECRETS.filter((n) => typed[n]).map(async (n) => [n, { enc: await encrypt(typed[n]), last4: tail(typed[n]) as string }] as const))) as Partial<Record<PaddleSecretName, { enc: string; last4: string }>>;
  const result = await prisma.$transaction(async (tx) => {
    const before = await readStored(tx);
    const envChanged = (before.environment ?? null) !== null && before.environment !== environment;
    if (envChanged && (!typed.apiKey || !typed.clientToken)) {
      throw new AdminError("invalid", "Switching between sandbox and live needs that account's API key and client-side token too (they are different Paddle accounts).");
    }
    const next: Stored = { ...before, ...encrypted, environment, updatedAt: new Date().toISOString() };
    // A webhook secret belongs to one account: switching environment without a new one drops the old one.
    if (envChanged && !typed.webhookSecret) next.webhookSecret = null;
    const changed = PADDLE_SECRETS.filter((n) => (before[n]?.enc ?? null) !== (next[n]?.enc ?? null));
    if (changed.length === 0 && before.environment === environment) return { environment, changed };
    await tx.adminSetting.upsert({ where: { key: PADDLE_SETTING_KEY }, create: { key: PADDLE_SETTING_KEY, value: next as Prisma.InputJsonObject }, update: { value: next as Prisma.InputJsonObject } });
    // Only the last 4 characters are audited ("endings"), never the values.
    await writeAudit(tx, ctx, "set_paddle_settings", `setting:${PADDLE_SETTING_KEY}`, { environment: before.environment ?? null, endings: endings(before) }, { environment, endings: endings(next), changed: changed.map((n) => AUDIT_NAME[n]) });
    return { environment, changed };
  });
  clearPaddleConfigCache();
  return result;
}

/** Stores the webhook secret Paddle returned when "Set up prices" created the notification destination. */
export async function storePaddleWebhookSecret(ctx: AdminContext, secret: string): Promise<void> {
  const enc = await encrypt(secret);
  await prisma.$transaction(async (tx) => {
    const before = await readStored(tx);
    if (before.webhookSecret?.enc && (await decrypt(before.webhookSecret.enc).catch(() => null)) === secret) return;
    const next: Stored = { ...before, webhookSecret: { enc, last4: tail(secret) as string }, updatedAt: new Date().toISOString() };
    await tx.adminSetting.upsert({ where: { key: PADDLE_SETTING_KEY }, create: { key: PADDLE_SETTING_KEY, value: next as Prisma.InputJsonObject }, update: { value: next as Prisma.InputJsonObject } });
    await writeAudit(tx, ctx, "set_paddle_settings", `setting:${PADDLE_SETTING_KEY}`, { endings: endings(before) }, { endings: endings(next), changed: ["webhook"], by: "set_up_prices" });
  });
  clearPaddleConfigCache();
}

/** Forgets the saved values (the environment variables, if any, apply again). Audited. */
export async function clearPaddleSettings(ctx: AdminContext): Promise<void> {
  if (ctx.viaApi) throw new AdminError("forbidden", "Paddle is connected in the admin console only.");
  await prisma.$transaction(async (tx) => {
    const before = await readStored(tx);
    await tx.adminSetting.deleteMany({ where: { key: PADDLE_SETTING_KEY } });
    await writeAudit(tx, ctx, "clear_paddle_settings", `setting:${PADDLE_SETTING_KEY}`, { environment: before.environment ?? null, endings: endings(before) }, null);
  });
  clearPaddleConfigCache();
}
