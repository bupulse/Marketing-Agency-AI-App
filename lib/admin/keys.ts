import "server-only";
import { prisma } from "@/lib/db";
import { hashApiKey } from "@/lib/api/keys";
import { writeAudit } from "./audit";
import { AdminError, type AdminContext } from "./types";

export const ADMIN_KEY_PREFIX = "bpj_live_";
export const MAX_ADMIN_KEYS = 10;

/** A new admin key: bpj_live_ + 32 random bytes in base64url. */
export function generateAdminKey(): { key: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  const key = ADMIN_KEY_PREFIX + btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { key, prefix: key.slice(0, ADMIN_KEY_PREFIX.length + 4) };
}

const keySelect = { id: true, name: true, prefix: true, ipAllowList: true, lastUsedAt: true, revokedAt: true, createdAt: true } as const;

// ---- IP allow-list: exact IPv4/IPv6 addresses and IPv4 CIDR ranges -----------------------------------------

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function v4ToInt(ip: string): number | null {
  const m = V4.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isV6(ip: string) {
  return ip.includes(":") && /^[0-9a-f:.]+$/i.test(ip) && ip.length <= 45;
}

export function isValidAllowEntry(entry: string): boolean {
  const [addr, bits, extra] = entry.split("/");
  if (extra !== undefined) return false;
  if (bits === undefined) return v4ToInt(addr) !== null || isV6(addr);
  const n = Number(bits);
  return v4ToInt(addr) !== null && Number.isInteger(n) && n >= 0 && n <= 32;
}

export function ipAllowed(ip: string | null | undefined, allowList: string[]): boolean {
  if (allowList.length === 0) return true;
  if (!ip) return false;
  const value = ip.trim().toLowerCase();
  const asInt = v4ToInt(value);
  return allowList.some((entry) => {
    const [addr, bits] = entry.toLowerCase().split("/");
    if (bits === undefined) return addr === value;
    const base = v4ToInt(addr);
    if (base === null || asInt === null) return false;
    const n = Number(bits);
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    return (base & mask) === (asInt & mask);
  });
}

function cleanAllowList(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new AdminError("invalid", "ipAllowList must be a list of IP addresses.");
  const list = [...new Set(input.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean))];
  for (const entry of list) {
    if (!isValidAllowEntry(entry)) throw new AdminError("invalid", `"${entry}" is not an IP address or an IPv4 range like 203.0.113.0/24.`);
  }
  if (list.length > 20) throw new AdminError("invalid", "At most 20 allowed addresses per key.");
  return list;
}

function cleanName(input: unknown): string {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new AdminError("invalid", "Give the key a name, for example \"Jarvis\".");
  if (name.length > 60) throw new AdminError("invalid", "That name is too long.");
  return name;
}

export async function listAdminKeys() {
  return prisma.adminApiKey.findMany({ orderBy: { createdAt: "desc" }, select: keySelect });
}

/** Who makes a key: the owner's keys can do everything; a staff member's key carries their permissions (scoped). */
export type KeyCreator = { isOwner: boolean; staffId: string | null; permissions: readonly string[] };
const OWNER_CREATOR: KeyCreator = { isOwner: true, staffId: null, permissions: [] };
const scopeOf = (c: KeyCreator) => (c.isOwner && !c.staffId ? { scoped: false, permissions: [] as string[], createdByStaffId: null } : { scoped: true, permissions: [...c.permissions], createdByStaffId: c.staffId });

/** Creates a key. The full key is returned once; only its hash is stored. */
export async function createAdminKey(ctx: AdminContext, input: { name?: unknown; ipAllowList?: unknown }, creator: KeyCreator = OWNER_CREATOR) {
  const name = cleanName(input.name);
  const ipAllowList = cleanAllowList(input.ipAllowList);
  if ((await prisma.adminApiKey.count({ where: { revokedAt: null } })) >= MAX_ADMIN_KEYS) {
    throw new AdminError("conflict", `You can have up to ${MAX_ADMIN_KEYS} active keys. Revoke one first.`);
  }
  const { key, prefix } = generateAdminKey();
  const scope = scopeOf(creator);
  const apiKey = await prisma.adminApiKey.create({ data: { name, prefix, hash: await hashApiKey(key), ipAllowList, ...scope }, select: keySelect });
  await writeAudit(prisma, ctx, "create_admin_key", `admin_key:${apiKey.id}`, null, { name, prefix, ipAllowList, scoped: scope.scoped, permissions: scope.permissions });
  return { key, apiKey };
}

/** Only the owner manages every key; a staff member only the keys they made (rotating an owner's key would hand them all). */
function assertKeyOwner(creator: KeyCreator, key: { createdByStaffId: string | null }) {
  if (creator.isOwner && !creator.staffId) return;
  if (!creator.staffId || key.createdByStaffId !== creator.staffId) throw new AdminError("forbidden", "You can only change keys you made yourself.");
}

export async function revokeAdminKey(ctx: AdminContext, id: string, creator: KeyCreator = OWNER_CREATOR) {
  const before = await prisma.adminApiKey.findUnique({ where: { id }, select: { ...keySelect, createdByStaffId: true } });
  if (!before) throw new AdminError("not_found", "That key does not exist.");
  assertKeyOwner(creator, before);
  const { count } = await prisma.adminApiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count !== 1) throw new AdminError("conflict", "That key is already revoked.");
  await writeAudit(prisma, ctx, "revoke_admin_key", `admin_key:${id}`, { name: before.name, prefix: before.prefix }, { revoked: true });
}

/** Issues a new key with the same name, allow-list and scope, and revokes the old one. */
export async function rotateAdminKey(ctx: AdminContext, id: string, creator: KeyCreator = OWNER_CREATOR) {
  const old = await prisma.adminApiKey.findUnique({ where: { id }, select: { ...keySelect, scoped: true, permissions: true, createdByStaffId: true } });
  if (!old || old.revokedAt) throw new AdminError("not_found", "That key does not exist or is already revoked.");
  assertKeyOwner(creator, old);
  const { key, prefix } = generateAdminKey();
  const apiKey = await prisma.adminApiKey.create({
    data: { name: old.name, prefix, hash: await hashApiKey(key), ipAllowList: old.ipAllowList, scoped: old.scoped, permissions: old.permissions, createdByStaffId: old.createdByStaffId },
    select: keySelect,
  });
  await prisma.adminApiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit(prisma, ctx, "rotate_admin_key", `admin_key:${id}`, { prefix: old.prefix }, { newKeyId: apiKey.id, prefix });
  return { key, apiKey };
}
