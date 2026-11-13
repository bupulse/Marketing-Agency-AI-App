import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { scrubSecrets } from "./scrub";
import { faultIssues, FAULT_SERVICE, type FaultKey, type ServiceFault } from "./service-faults-rules";

// A partner refusing BuPulse itself (a refused API key, a plan limit) is one problem for the owner, not one error per
// call: Composio answered "invalid API key" to every inbox read, metric and post, and Upload-Post's profile limit to
// every Connect press, each a row in Admin -> Errors (13 November 2026). Here such a fault is written ONCE to the
// AdminSetting "health.serviceFaults" (one warning in Admin -> Errors when it starts), Admin -> Health shows it as one
// item until it is fixed (service-faults-rules.ts), and the errors thrown for it carry `serviceFault`, so logError
// skips them (lib/errors.ts). A refused key is remembered by a short hash of the key (never the key), so pasting a new
// key in Admin -> Services clears it at once; a passing "Test now" or the next good answer clears it too.

export { FAULT_SERVICE, type FaultKey, type ServiceFault } from "./service-faults-rules";

export const SERVICE_FAULTS_SETTING = "health.serviceFaults";
const CACHE_MS = 30_000;
/** A fault already recorded is written again (count, last time) at most this often. */
const REWRITE_MS = 10 * 60_000;

type Faults = Partial<Record<FaultKey, ServiceFault>>;
type Db = Pick<typeof prisma, "adminSetting">;

let cache: { at: number; faults: Faults } | null = null;
const lastWrite = new Map<FaultKey, number>();
const unsaved = new Map<FaultKey, number>();
/** Faults this process already wrote its one warning for (by key hash). */
const announced = new Map<FaultKey, string>();

/** A short, one-way fingerprint of a key: tells "the same key" from "a new key" without keeping the key. */
export const keyHash = (key: string) => createHash("sha256").update(key.trim()).digest("hex").slice(0, 16);

/** Tests: forget the cache and the throttles. */
export function resetServiceFaultsForTests() {
  cache = null;
  lastWrite.clear();
  unsaved.clear();
  announced.clear();
}

function clean(value: unknown): Faults {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Faults) : {};
}

async function read(db: Db, fresh = false): Promise<Faults> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.faults;
  try {
    const row = await db.adminSetting.findUnique({ where: { key: SERVICE_FAULTS_SETTING } });
    cache = { at: Date.now(), faults: clean(row?.value) };
  } catch {
    cache = { at: Date.now(), faults: cache?.faults ?? {} };
  }
  return cache.faults;
}

async function write(db: Db, faults: Faults) {
  const value = faults as unknown as Prisma.InputJsonValue;
  await db.adminSetting.upsert({ where: { key: SERVICE_FAULTS_SETTING }, create: { key: SERVICE_FAULTS_SETTING, value }, update: { value } });
  cache = { at: Date.now(), faults };
}

/** Marks an error as belonging to a recorded fault: logError leaves it out of Admin -> Errors (Health shows it). */
export function asFault<E extends Error>(error: E, key: FaultKey): E {
  (error as E & { serviceFault?: FaultKey }).serviceFault = key;
  return error;
}

/**
 * Records that `key` happened. The first time (or with a different API key than the one recorded) it writes one
 * warning to Admin -> Errors. Never throws.
 */
export async function reportServiceFault(key: FaultKey, detail: string, opts: { apiKey?: string; untilMs?: number; db?: Db } = {}): Promise<void> {
  const db = opts.db ?? prisma;
  try {
    const now = new Date();
    const hash = opts.apiKey ? keyHash(opts.apiKey) : null;
    const known = (await read(db))[key];
    const isNew = !known || (hash !== null && known.keyHash !== hash) || (known.until && Date.parse(known.until) < now.getTime());
    unsaved.set(key, (unsaved.get(key) ?? 0) + 1);
    if (!isNew && Date.now() - (lastWrite.get(key) ?? 0) < REWRITE_MS) return;
    const faults = { ...(await read(db, true)) };
    const before = faults[key];
    const fresh = !before || isNew;
    faults[key] = {
      key,
      since: fresh ? now.toISOString() : before.since,
      lastAt: now.toISOString(),
      count: (fresh ? 0 : before.count) + (unsaved.get(key) ?? 1),
      detail: scrubSecrets(detail.replace(/\s+/g, " "), 200),
      keyHash: hash ?? before?.keyHash ?? null,
      until: opts.untilMs ? new Date(now.getTime() + opts.untilMs).toISOString() : null,
    };
    let saved = true;
    try {
      await write(db, faults);
      lastWrite.set(key, Date.now());
      unsaved.delete(key);
    } catch {
      saved = false;
    }
    // One warning when it starts. If the database cannot be written, once per server process for this key instead.
    const signature = hash ?? "";
    if ((saved && fresh) || (!saved && announced.get(key) !== signature)) {
      announced.set(key, signature);
      await logError(new Error(`${FAULT_SERVICE[key].name}: ${faults[key]!.detail} (shown on Admin -> Health until it is fixed; not repeated here)`), { source: `service-fault.${key}`, level: "warn" });
    }
  } catch {
    // Monitoring never breaks the call that failed.
  }
}

/** The fault, while it applies: not expired, and for a refused key only while that same key is still the one in use. */
export async function activeServiceFault(key: FaultKey, opts: { apiKey?: string; db?: Db } = {}): Promise<ServiceFault | null> {
  const f = (await read(opts.db ?? prisma))[key];
  if (!f) return null;
  if (f.until && Date.parse(f.until) < Date.now()) return null;
  if (opts.apiKey && f.keyHash && f.keyHash !== keyHash(opts.apiKey)) return null;
  return f;
}

/** Clears a fault (a good answer, a passing Test now). Cheap when there is none: reads the cached row only. */
export async function clearServiceFault(key: FaultKey, db: Db = prisma): Promise<void> {
  try {
    if (!(await read(db))[key]) return;
    const faults = { ...(await read(db, true)) };
    if (!faults[key]) return;
    delete faults[key];
    await write(db, faults);
    lastWrite.delete(key);
    unsaved.delete(key);
  } catch {
    // Cleared next time.
  }
}

/** The faults of one service (Admin -> Services "Test now" clears them when the test passes). */
export async function clearServiceFaultsOf(service: string): Promise<void> {
  for (const key of Object.keys(FAULT_SERVICE) as FaultKey[]) if (FAULT_SERVICE[key].service === service && FAULT_SERVICE[key].clearedByTest) await clearServiceFault(key);
}

/** For Admin -> Health. */
export async function loadServiceFaultIssues(now = new Date()) {
  try {
    return faultIssues(Object.values(await read(prisma, true)).filter((f): f is ServiceFault => Boolean(f)), now);
  } catch {
    return [];
  }
}
