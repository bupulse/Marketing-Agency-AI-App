import "server-only";
import { prisma } from "@/lib/db";

/** Scopes a key can have. Reads are separate from writes so a reporting tool never gets write access. */
export const API_SCOPES = ["projects:read", "content:read", "posts:read", "posts:write", "leads:read", "leads:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABELS: Record<ApiScope, string> = {
  "projects:read": "Read projects",
  "content:read": "Read generated content",
  "posts:read": "Read posts",
  "posts:write": "Create draft posts",
  "leads:read": "Read leads",
  "leads:write": "Change lead status and notes",
};

export const MAX_API_KEYS = 10;
export const KEY_PREFIX = "bp_live_";

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPES as readonly string[]).includes(value);
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes instanceof Uint8Array ? bytes : bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

const encoder = new TextEncoder();
const PEPPER_INFO = "bupulse:api-key-pepper:v1";

/**
 * The server secret mixed into every key hash: API_KEY_PEPPER, or else a key derived (HKDF) from ENCRYPTION_KEY for
 * this one purpose. With it, a leaked copy of the hash column cannot be checked against guessed keys offline.
 * Changing it (or ENCRYPTION_KEY while API_KEY_PEPPER is unset) makes every existing key invalid (docs/API.md).
 */
async function pepperKey(): Promise<CryptoKey> {
  const pepper = process.env.API_KEY_PEPPER;
  if (pepper) return crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const base = process.env.ENCRYPTION_KEY;
  if (!base) throw new Error("API_KEY_PEPPER (or ENCRYPTION_KEY) is not set");
  const ikm = await crypto.subtle.importKey("raw", encoder.encode(base), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode(PEPPER_INFO) },
    ikm,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

/** HMAC-SHA256 of the key with the server pepper, hex. What is stored for every new key (REST API and admin keys). */
export async function hashApiKey(key: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", await pepperKey(), encoder.encode(key)));
}

/** The plain SHA-256 hash keys had before the pepper (Phase 9). Only for finding and rehashing those keys. */
export async function legacyHashApiKey(key: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(key)));
}

/**
 * Finds a key by its hash: the peppered hash first, then the legacy unpeppered one. A key found by its legacy hash is
 * rehashed in place on this use, so old keys keep working and move to the pepper one by one. `find` and `rehash` are
 * the table's own lookup and update (ApiKey or AdminApiKey).
 */
export async function findByKeyHash<T extends { id: string }>(
  key: string,
  find: (hash: string) => Promise<T | null>,
  rehash: (id: string, from: string, to: string) => Promise<unknown>,
): Promise<T | null> {
  const hash = await hashApiKey(key);
  const current = await find(hash);
  if (current) return current;
  const legacy = await legacyHashApiKey(key);
  const old = await find(legacy);
  if (old) await rehash(old.id, legacy, hash).catch(() => {});
  return old;
}

/** A new key: bp_live_ + 32 random bytes in base64url. */
export function generateApiKey(): { key: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  const key = KEY_PREFIX + btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 4) };
}

export class ApiKeyError extends Error {
  constructor(public code: "invalid" | "limit" | "not_found", message: string) {
    super(message);
  }
}

export function validateKeyInput(input: { name?: unknown; scopes?: unknown }): { name: string; scopes: ApiScope[] } {
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new ApiKeyError("invalid", "Give the key a name, for example \"Zapier\" or \"Reporting\".");
  if (name.length > 60) throw new ApiKeyError("invalid", "That name is too long.");
  const scopes = Array.isArray(input.scopes) ? [...new Set(input.scopes.filter(isApiScope))] : [];
  if (scopes.length === 0) throw new ApiKeyError("invalid", "Choose at least one permission.");
  return { name, scopes };
}

const keySelect = { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true } as const;

export async function listApiKeys(businessId: string) {
  return prisma.apiKey.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, select: keySelect });
}

/** Creates a key. The full key is returned once; only its hash is stored. */
export async function createApiKey(businessId: string, input: { name?: unknown; scopes?: unknown }) {
  const { name, scopes } = validateKeyInput(input);
  if ((await prisma.apiKey.count({ where: { businessId, revokedAt: null } })) >= MAX_API_KEYS) {
    throw new ApiKeyError("limit", `You can have up to ${MAX_API_KEYS} active keys. Revoke one first.`);
  }
  const { key, prefix } = generateApiKey();
  const created = await prisma.apiKey.create({ data: { businessId, name, prefix, hash: await hashApiKey(key), scopes }, select: keySelect });
  return { key, apiKey: created };
}

export async function revokeApiKey(businessId: string, id: string) {
  const result = await prisma.apiKey.updateMany({ where: { id, businessId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (result.count !== 1) throw new ApiKeyError("not_found", "That key no longer exists.");
}
