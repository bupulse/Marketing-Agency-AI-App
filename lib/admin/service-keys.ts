import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logError } from "@/lib/errors";
import { writeAudit } from "./audit";
import { SAVABLE_KEYS, customKeyNames, customNameProblem, isSavableKey, keyValueProblem, shownValue } from "./service-keys-rules";
import { serviceInfo, type ServiceId } from "./service-catalog";
import { AdminError, type AdminContext } from "./types";

// Keys entered in Admin -> Services, kept in AdminSetting "services.keys", each value encrypted with ENCRYPTION_KEY
// (lib/crypto.ts) like Paddle's keys and the OAuth tokens, never shown again (only the last 4 characters of a secret).
//
// How they reach the code: BuPulse reads its keys from process.env everywhere. loadServiceKeys() puts the saved values
// there (a saved value wins over the hosting environment's, as Paddle's do; removing it brings the environment's value
// back). It runs wherever a feature checks its service's switch (lib/admin/switch.ts), when a page or action reads the
// signed-in user, in every cron job and API call, and on this page, and asks the database at most every 30 seconds per
// server instance, so a saved key reaches every instance within half a minute without a redeploy.
//
// Custom keys go in the same row, under the variable name the owner chose (code reads it from process.env by that name, or
// getCustomKey(NAME)). They never replace a variable the hosting environment sets (lib/admin/service-keys-rules.ts).

export const SERVICE_KEYS_SETTING = "services.keys";
const TTL_MS = 30_000;

type SavedValue = { enc: string; shown: string; savedAt: string; savedBy: string };
type SavedCustom = SavedValue & { id: string; envName: string; label: string; details: string; website: string | null };
type Stored = { rev?: number; values?: Record<string, SavedValue>; custom?: SavedCustom[] };

/** A saved key as the page shows it (never the value). `shown` is the last 4 characters of a secret, or a setting in full. */
export type SavedKeyView = { name: string; service: ServiceId; shown: string; savedAt: string; savedBy: string };
export type CustomKeyView = { id: string; envName: string; label: string; details: string; website: string | null; shown: string; savedAt: string; savedBy: string; inUse: boolean };

// ---- loading into process.env ------------------------------------------------------------------------------

/** What the hosting environment had for each name before a saved value replaced it (undefined: nothing). */
const original = new Map<string, string | undefined>();
let applied: { at: number; rev: number } | null = null;
let inFlight: Promise<void> | null = null;
let decryptFailed = new Set<string>();

function cleanStored(value: unknown): Stored {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Stored) : {};
}

async function readStored(db: Pick<typeof prisma, "adminSetting"> = prisma): Promise<Stored> {
  const row = await db.adminSetting.findUnique({ where: { key: SERVICE_KEYS_SETTING } });
  return cleanStored(row?.value);
}

/** The value the hosting environment gives `name`, ignoring anything saved here. */
export function hostValue(name: string): string | undefined {
  return original.has(name) ? original.get(name) : process.env[name];
}

function setEnv(name: string, value: string | undefined) {
  if (!original.has(name)) original.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Puts the saved values in process.env and gives back the environment's own value of anything no longer saved. */
async function apply(stored: Stored) {
  const next = new Map<string, string>();
  const failed = new Set<string>();
  const open = async (name: string, enc: string) => {
    try {
      next.set(name, await decrypt(enc));
    } catch (error) {
      failed.add(name);
      await logError(error, { source: "admin.service-keys", value: name, note: "a key saved in Admin -> Services could not be decrypted (ENCRYPTION_KEY changed?); save it again" }).catch(() => {});
    }
  };
  for (const [name, v] of Object.entries(stored.values ?? {})) if (isSavableKey(name) && v?.enc) await open(name, v.enc);
  const custom = (stored.custom ?? []).filter((c) => c?.enc && !customNameProblem(c.envName) && !hostValue(c.envName));
  for (const c of custom) await open(c.envName, c.enc);
  for (const [name, value] of next) setEnv(name, value);
  for (const name of [...original.keys()]) {
    if (next.has(name)) continue;
    const before = original.get(name);
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
    original.delete(name);
  }
  customKeyNames.clear();
  for (const c of custom) if (next.has(c.envName)) customKeyNames.add(c.envName);
  decryptFailed = failed;
}

/**
 * Makes sure the saved keys are in process.env: reads the setting at most every 30 seconds (`force`: now) and decrypts
 * only when it changed. Never throws: if the database cannot be read, the last values stay in place.
 */
export async function loadServiceKeys(opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force && applied && Date.now() - applied.at < TTL_MS) return;
  if (inFlight && !opts.force) return inFlight;
  const run = (async () => {
    try {
      const stored = await readStored();
      const rev = Number(stored.rev ?? 0);
      if (!applied || opts.force || applied.rev !== rev) await apply(stored);
      applied = { at: Date.now(), rev };
    } catch {
      applied = { at: Date.now(), rev: applied?.rev ?? -1 };
    }
  })();
  inFlight = run;
  try {
    await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

/** Tests: forget what was loaded and give the environment back its own values. */
export function resetServiceKeysForTests() {
  for (const [name, before] of original) {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
  original.clear();
  customKeyNames.clear();
  applied = null;
  inFlight = null;
  decryptFailed = new Set();
}

/** A custom key's value (saved here), or null. */
export async function getCustomKey(envName: string): Promise<string | null> {
  await loadServiceKeys();
  return customKeyNames.has(envName) ? (process.env[envName] ?? null) : null;
}

// ---- reads for the page ------------------------------------------------------------------------------------

export async function listSavedKeys(): Promise<{ values: Map<string, SavedKeyView>; custom: CustomKeyView[]; unreadable: string[] }> {
  await loadServiceKeys();
  const stored = await readStored().catch(() => ({}) as Stored);
  const values = new Map<string, SavedKeyView>();
  for (const [name, v] of Object.entries(stored.values ?? {})) {
    const service = SAVABLE_KEYS.get(name);
    if (service && v?.enc) values.set(name, { name, service, shown: v.shown, savedAt: v.savedAt, savedBy: v.savedBy });
  }
  const custom = (stored.custom ?? []).map((c) => ({
    id: c.id,
    envName: c.envName,
    label: c.label,
    details: c.details,
    website: c.website,
    shown: c.shown,
    savedAt: c.savedAt,
    savedBy: c.savedBy,
    inUse: customKeyNames.has(c.envName),
  }));
  return { values, custom, unreadable: [...decryptFailed] };
}

// ---- writes ------------------------------------------------------------------------------------------------

function assertCanEncrypt() {
  if (!process.env.ENCRYPTION_KEY) throw new AdminError("invalid", "Saving keys needs ENCRYPTION_KEY in the hosting environment (docs/DEPLOY.md). Add it, redeploy, then try again.");
}

async function write(ctx: AdminContext, action: string, target: string, change: (s: Stored) => { before: unknown; after: unknown }) {
  assertCanEncrypt();
  await prisma.$transaction(async (tx) => {
    const stored = await readStored(tx);
    const { before, after } = change(stored);
    stored.rev = Number(stored.rev ?? 0) + 1;
    const value = stored as unknown as Prisma.InputJsonValue;
    await tx.adminSetting.upsert({ where: { key: SERVICE_KEYS_SETTING }, create: { key: SERVICE_KEYS_SETTING, value }, update: { value } });
    await writeAudit(tx, ctx, action, target, before, after);
  });
  await loadServiceKeys({ force: true });
}

const sealed = async (name: string, value: string): Promise<Omit<SavedValue, "savedBy">> => ({ enc: await encrypt(value), shown: shownValue(name, value), savedAt: new Date().toISOString() });

/** Saves (or replaces) one of a service's keys. It is used from the next call on, everywhere within 30 seconds. */
export async function saveServiceKey(ctx: AdminContext, input: { name: string; value: string }): Promise<{ service: ServiceId; name: string }> {
  const name = input.name.trim();
  const service = SAVABLE_KEYS.get(name);
  if (!service) throw new AdminError("invalid", `${name || "That key"} cannot be saved here.`);
  const value = input.value.trim();
  const problem = keyValueProblem(name, value);
  if (problem) throw new AdminError("invalid", problem);
  assertCanEncrypt();
  const entry = { ...(await sealed(name, value)), savedBy: ctx.actor };
  await write(ctx, "save_service_key", `service:${service}`, (s) => {
    const prev = s.values?.[name];
    s.values = { ...(s.values ?? {}), [name]: entry };
    // Neutral field names: the audit log redacts anything called a key, token or secret.
    return { before: prev ? { variable: name, ending: prev.shown } : { variable: name, ending: null }, after: { variable: name, ending: entry.shown } };
  });
  // The last "Test now" was about the old value.
  await prisma.serviceCheck.deleteMany({ where: { service } }).catch(() => {});
  return { service, name };
}

/** Removes a saved key: the hosting environment's value (if any) applies again. */
export async function removeServiceKey(ctx: AdminContext, input: { name: string }): Promise<{ service: ServiceId; name: string; fallback: boolean }> {
  const name = input.name.trim();
  const service = SAVABLE_KEYS.get(name);
  if (!service) throw new AdminError("invalid", `${name || "That key"} is not saved here.`);
  await write(ctx, "remove_service_key", `service:${service}`, (s) => {
    const prev = s.values?.[name];
    if (!prev) throw new AdminError("not_found", `${name} is not saved here.`);
    const values = { ...(s.values ?? {}) };
    delete values[name];
    s.values = values;
    return { before: { variable: name, ending: prev.shown }, after: { variable: name, ending: null } };
  });
  await prisma.serviceCheck.deleteMany({ where: { service } }).catch(() => {});
  return { service, name, fallback: Boolean(hostValue(name)) };
}

const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function cleanWebsite(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("scheme");
    return url.toString().slice(0, 300);
  } catch {
    throw new AdminError("invalid", "The website does not look like a web address, for example https://example.com/docs.");
  }
}

/**
 * Adds a custom key, or (with `id`) changes its details and, when `value` is given, its value. The variable name is
 * fixed once saved (code may read it); to rename, add a new key and remove the old one.
 */
export async function saveCustomKey(
  ctx: AdminContext,
  input: { id?: string; envName?: string; label: string; details?: string; website?: string; value?: string },
): Promise<{ id: string; envName: string; created: boolean }> {
  const label = cleanText(input.label, 80);
  if (label.length < 2) throw new AdminError("invalid", "Give the key a name, for example Seedream images.");
  const details = cleanText(input.details, 500);
  const website = cleanWebsite(input.website ?? "");
  const value = (input.value ?? "").trim();
  const envName = (input.envName ?? "").trim().toUpperCase();
  if (!input.id) {
    const problem = customNameProblem(envName, { hostSet: Boolean(hostValue(envName)) });
    if (problem) throw new AdminError("invalid", problem);
    if (!value) throw new AdminError("invalid", "Paste the key's value.");
  }
  if (value) {
    // A custom key is treated as a secret whatever its name: only its last 4 characters are ever shown.
    const problem = keyValueProblem(`${envName || "CUSTOM"}_KEY`, value);
    if (problem) throw new AdminError("invalid", problem);
  }
  assertCanEncrypt();
  const sealedValue = value ? { enc: await encrypt(value), shown: value.slice(-4), savedAt: new Date().toISOString(), savedBy: ctx.actor } : null;
  let result = { id: input.id ?? "", envName, created: !input.id };
  await write(ctx, input.id ? "update_custom_key" : "add_custom_key", "service:custom", (s) => {
    const list = [...(s.custom ?? [])];
    if (input.id) {
      const i = list.findIndex((c) => c.id === input.id);
      if (i < 0) throw new AdminError("not_found", "That custom key no longer exists.");
      const prev = list[i]!;
      list[i] = { ...prev, ...(sealedValue ?? {}), label, details, website };
      s.custom = list;
      result = { id: prev.id, envName: prev.envName, created: false };
      return {
        before: { variable: prev.envName, name: prev.label, ending: prev.shown, details: prev.details, website: prev.website },
        after: { variable: prev.envName, name: label, ending: list[i]!.shown, details, website },
      };
    }
    if (list.some((c) => c.envName === envName)) throw new AdminError("invalid", customNameProblem(envName, { taken: true })!);
    const id = crypto.randomUUID();
    list.push({ ...sealedValue!, id, envName, label, details, website });
    s.custom = list;
    result = { id, envName, created: true };
    return { before: null, after: { variable: envName, name: label, ending: sealedValue!.shown, details, website } };
  });
  return result;
}

/** Removes a custom key: code that reads it gets nothing from the next call on. */
export async function removeCustomKey(ctx: AdminContext, input: { id: string }): Promise<{ envName: string }> {
  let envName = "";
  await write(ctx, "remove_custom_key", "service:custom", (s) => {
    const prev = (s.custom ?? []).find((c) => c.id === input.id);
    if (!prev) throw new AdminError("not_found", "That custom key no longer exists.");
    s.custom = (s.custom ?? []).filter((c) => c.id !== input.id);
    envName = prev.envName;
    return { before: { variable: prev.envName, name: prev.label, ending: prev.shown }, after: null };
  });
  return { envName };
}

/** The service a saved key belongs to (for messages). */
export const serviceOfKey = (name: string) => {
  const id = SAVABLE_KEYS.get(name);
  return id ? serviceInfo(id) : null;
};
