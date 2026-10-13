import "server-only";
import { getPaddleConfig, paddleCredentialsComplete } from "@/lib/billing/paddle-config";
import { prisma } from "@/lib/db";
import { writeAudit } from "./audit";
import { SERVICES, isServiceId, networksOf, serviceInfo, type ServiceId, type ServiceInfo } from "./service-catalog";
import { runProbe } from "./service-tests";
import { scrubSecrets } from "./scrub";
import { clearSwitchCache } from "./switch";
import { AdminError, type AdminContext } from "./types";

// Services control: the registry with live configuration state, the last health test, the last error, usage and the
// kill switch. Reports only whether environment variables are SET, never their values.

export type EnvState = { name: string; set: boolean };
export type CheckView = { ok: boolean; latencyMs: number; message: string | null; checkedAt: string };
export type UsageLine = { label: string; value: number | string };

export type ServiceView = {
  id: ServiceId;
  name: string;
  purpose: string;
  features: string[];
  killable: boolean;
  whenOff: string;
  env: EnvState[];
  optionalEnv: EnvState[];
  /** configured: every required variable is set. missing: some are not. not_in_use: optional service not selected. no_keys: needs none. */
  configured: "configured" | "missing" | "not_in_use" | "no_keys";
  enabled: boolean;
  disabledReason: string | null;
  disabledBy: string | null;
  disabledAt: string | null;
  lastCheck: CheckView | null;
  lastError: { at: string; message: string; source: string } | null;
  usage: UsageLine[];
  /**
   * One word for a status badge. off > down > missing > ok > untested. "missing" is a core service without its keys
   * (a problem); "not_connected" is any other service whose keys are not set yet (not set up, not a failure).
   */
  health: "off" | "down" | "missing" | "not_connected" | "ok" | "untested" | "not_in_use";
};

const isSet = (name: string) => Boolean(process.env[name]);
/** Paddle connected in Admin -> Settings (lib/billing/paddle-config.ts) counts as configured, whatever the env says. */
const paddleSavedInSettings = async () => paddleCredentialsComplete(await getPaddleConfig().catch(() => ({ apiKey: null, clientToken: null, webhookSecret: null })));
const DAY_MS = 24 * 60 * 60 * 1000;

/** `paddleSaved`: Paddle's three values are saved in Admin -> Settings (they stand in for the environment variables). */
export function configState(info: ServiceInfo, opts: { paddleSaved?: boolean } = {}): ServiceView["configured"] {
  if (info.env.length === 0) return "no_keys";
  if (info.id === "paddle" && opts.paddleSaved) return "configured";
  if (info.id === "claude" && (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase() !== "claude" && !isSet("ANTHROPIC_API_KEY")) return "not_in_use";
  return info.env.every(isSet) ? "configured" : "missing";
}

/** Missing keys are a problem only for a core service (lib/admin/service-catalog.ts `core`); Turnstile only in production. */
export function isCoreService(info: Pick<ServiceInfo, "core">, env: string | undefined = process.env.NODE_ENV): boolean {
  return info.core === "always" || (info.core === "production" && env === "production");
}

function healthOf(v: Pick<ServiceView, "enabled" | "configured" | "lastCheck">, core: boolean): ServiceView["health"] {
  if (!v.enabled) return "off";
  if (v.configured === "not_in_use") return "not_in_use";
  if (v.configured === "missing") return core ? "missing" : "not_connected";
  if (!v.lastCheck) return "untested";
  return v.lastCheck.ok ? "ok" : "down";
}

// ---- usage and last error ----------------------------------------------------------------------------------

type Loaded = {
  ai: Map<string, { calls: number; failed: number; costUsd: number }>;
  aiLastFailure: Map<string, { at: Date; error: string }>;
  emails: { ok: number; failed: number };
  paddleEvents: number;
  published: Map<string, number>;
  postFailed: Map<string, { at: Date; error: string }>;
  imports: Map<string, number>;
  connections: Map<string, number>;
  errors: { createdAt: Date; source: string; message: string }[];
};

const empty = <T,>(value: T) => (p: Promise<T>) => p.catch(() => value);

async function load(since: Date): Promise<Loaded> {
  const [aiRows, aiFail, usage, paddle, pubRows, failedPosts, imports, canva, stores, cf, errors] = await Promise.all([
    empty<{ provider: string; success: boolean; _count: { _all: number }; _sum: { costUsd: unknown } }[]>([])(
      prisma.aiCall.groupBy({ by: ["provider", "success"], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { costUsd: true } }) as never,
    ),
    empty<{ provider: string; error: string | null; createdAt: Date }[]>([])(prisma.aiCall.findMany({ where: { success: false }, orderBy: { createdAt: "desc" }, take: 20, select: { provider: true, error: true, createdAt: true } })),
    empty<{ ok: number; failed: number }[]>([])(prisma.serviceUsage.findMany({ where: { service: "resend", day: { gte: since } }, select: { ok: true, failed: true } })),
    empty(0)(prisma.billingEvent.count({ where: { createdAt: { gte: since }, type: { startsWith: "transaction." } } })),
    empty<{ network: string; _count: { _all: number } }[]>([])(prisma.post.groupBy({ by: ["network"], where: { status: "PUBLISHED", publishedAt: { gte: since } }, _count: { _all: true } }) as never),
    empty<{ network: string; lastError: string | null; updatedAt: Date }[]>([])(prisma.post.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 30, select: { network: true, lastError: true, updatedAt: true } })),
    empty<{ source: string | null; _count: { _all: number } }[]>([])(prisma.mediaAsset.groupBy({ by: ["source"], where: { createdAt: { gte: since }, source: { not: null } }, _count: { _all: true } }) as never),
    empty(0)(prisma.canvaConnection.count()),
    empty<{ provider: string; _count: { _all: number } }[]>([])(prisma.storeConnection.groupBy({ by: ["provider"], _count: { _all: true } }) as never),
    empty(0)(prisma.cloudflareConnection.count()),
    empty<{ createdAt: Date; source: string; message: string }[]>([])(prisma.errorLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) } }, orderBy: { createdAt: "desc" }, take: 300, select: { createdAt: true, source: true, message: true } })),
  ]);
  const ai: Loaded["ai"] = new Map();
  for (const r of aiRows) {
    const cur = ai.get(r.provider) ?? { calls: 0, failed: 0, costUsd: 0 };
    cur.calls += r._count._all;
    if (!r.success) cur.failed += r._count._all;
    cur.costUsd += Number(r._sum.costUsd ?? 0);
    ai.set(r.provider, cur);
  }
  const aiLastFailure: Loaded["aiLastFailure"] = new Map();
  for (const r of aiFail) if (!aiLastFailure.has(r.provider)) aiLastFailure.set(r.provider, { at: r.createdAt, error: r.error ?? "failed" });
  const published = new Map(pubRows.map((r) => [r.network, r._count._all]));
  const postFailed: Loaded["postFailed"] = new Map();
  for (const p of failedPosts) if (!postFailed.has(p.network) && p.lastError) postFailed.set(p.network, { at: p.updatedAt, error: p.lastError });
  const connections = new Map<string, number>([["canva", canva], ["cloudflare", cf]]);
  for (const r of stores) connections.set(r.provider, r._count._all);
  return {
    ai,
    aiLastFailure,
    emails: { ok: usage.reduce((n, r) => n + r.ok, 0), failed: usage.reduce((n, r) => n + r.failed, 0) },
    paddleEvents: paddle,
    published,
    postFailed,
    imports: new Map(imports.map((r) => [r.source ?? "", r._count._all])),
    connections,
    errors,
  };
}

/** Substrings of ErrorLog.source that belong to a service (case-insensitive). */
const ERROR_SOURCES: Partial<Record<ServiceId, string[]>> = {
  resend: ["email"],
  paddle: ["billing", "paddle"],
  supabase: ["storage", "account-deletion"],
  turnstile: ["turnstile"],
  canva: ["canva"],
  "google-drive": ["media.import", "drive"],
  dropbox: ["dropbox"],
  shopify: ["shopify", "stores.", "store-sync"],
  woocommerce: ["woo", "stores."],
  cloudflare: ["cloudflare", "domains"],
};

function lastErrorOf(info: ServiceInfo, d: Loaded): ServiceView["lastError"] {
  const candidates: { at: Date; message: string; source: string }[] = [];
  const ai = d.aiLastFailure.get(info.id);
  if (ai) candidates.push({ at: ai.at, message: ai.error, source: "ai call" });
  for (const network of networksOf(info.id)) {
    const p = d.postFailed.get(network);
    if (p) candidates.push({ at: p.at, message: p.error, source: `publishing ${network}` });
  }
  const needles = [...(ERROR_SOURCES[info.id] ?? []), ...networksOf(info.id)].map((s) => s.toLowerCase());
  if (needles.length) {
    const hit = d.errors.find((e) => needles.some((n) => e.source.toLowerCase().includes(n)));
    if (hit) candidates.push({ at: hit.createdAt, message: hit.message, source: hit.source });
  }
  candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
  const top = candidates[0];
  return top ? { at: top.at.toISOString(), message: scrubSecrets(top.message, 240), source: top.source } : null;
}

function usageOf(info: ServiceInfo, d: Loaded): UsageLine[] {
  switch (info.id) {
    case "gemini":
    case "claude": {
      const a = d.ai.get(info.id);
      return [
        { label: "AI calls (30 days)", value: a?.calls ?? 0 },
        { label: "Failed calls", value: a?.failed ?? 0 },
        { label: "Cost (30 days, USD)", value: Number((a?.costUsd ?? 0).toFixed(4)) },
      ];
    }
    case "resend":
      return [{ label: "Emails sent (30 days)", value: d.emails.ok }, { label: "Emails refused", value: d.emails.failed }];
    case "paddle":
      return [{ label: "Transaction events (30 days)", value: d.paddleEvents }];
    case "meta":
    case "linkedin":
    case "tiktok":
    case "youtube":
      return networksOf(info.id).map((n) => ({ label: `Posts published on ${n} (30 days)`, value: d.published.get(n) ?? 0 }));
    case "google-drive":
      return [{ label: "Files imported (30 days)", value: d.imports.get("google_drive") ?? 0 }];
    case "dropbox":
      return [{ label: "Files imported (30 days)", value: d.imports.get("dropbox") ?? 0 }];
    case "canva":
      return [{ label: "Connected accounts", value: d.connections.get("canva") ?? 0 }, { label: "Designs imported (30 days)", value: d.imports.get("canva") ?? 0 }];
    case "shopify":
    case "woocommerce":
      return [{ label: "Connected stores", value: d.connections.get(info.id) ?? 0 }];
    case "cloudflare":
      return [{ label: "Connected accounts", value: d.connections.get("cloudflare") ?? 0 }];
    default:
      return [];
  }
}

// ---- reads -------------------------------------------------------------------------------------------------

export async function listServices(now = new Date()): Promise<ServiceView[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [switches, checks, d] = await Promise.all([
    prisma.serviceSwitch.findMany().catch(() => []),
    prisma.serviceCheck.findMany().catch(() => []),
    load(since),
  ]);
  const switchOf = new Map(switches.map((s) => [s.service, s]));
  const checkOf = new Map(checks.map((c) => [c.service, c]));
  const paddleSaved = await paddleSavedInSettings();
  return SERVICES.map((info): ServiceView => {
    const sw = switchOf.get(info.id);
    const check = checkOf.get(info.id);
    const base = {
      enabled: !(sw && !sw.enabled && info.killable),
      configured: configState(info, { paddleSaved }),
      lastCheck: check ? { ok: check.ok, latencyMs: check.latencyMs, message: check.message, checkedAt: check.checkedAt.toISOString() } : null,
    };
    return {
      id: info.id,
      name: info.name,
      purpose: info.purpose,
      features: info.features,
      killable: info.killable,
      whenOff: info.whenOff,
      env: info.env.map((name) => ({ name, set: isSet(name) })),
      optionalEnv: (info.optionalEnv ?? []).map((name) => ({ name, set: isSet(name) })),
      ...base,
      disabledReason: !base.enabled ? (sw?.reason ?? null) : null,
      disabledBy: !base.enabled ? (sw?.changedBy ?? null) : null,
      disabledAt: !base.enabled ? (sw?.updatedAt.toISOString() ?? null) : null,
      lastError: lastErrorOf(info, d),
      usage: usageOf(info, d),
      health: healthOf(base, isCoreService(info)),
    };
  });
}

export async function getService(id: string): Promise<ServiceView> {
  if (!isServiceId(id)) throw new AdminError("not_found", `Unknown service "${id}".`);
  const all = await listServices();
  return all.find((s) => s.id === id)!;
}

// ---- actions -----------------------------------------------------------------------------------------------

/** "Test now": runs the service's cheap health check, stores the (scrubbed) result and audits it. */
export async function testService(ctx: AdminContext, id: string) {
  if (!isServiceId(id)) throw new AdminError("not_found", `Unknown service "${id}".`);
  const result = await runProbe(id);
  const data = { ok: result.ok, latencyMs: result.latencyMs, message: result.message, checkedAt: new Date() };
  await prisma.$transaction(async (tx) => {
    await tx.serviceCheck.upsert({ where: { service: id }, create: { service: id, ...data }, update: data });
    await writeAudit(tx, ctx, "test_service", `service:${id}`, null, { ok: result.ok, latencyMs: result.latencyMs, message: result.message });
  });
  return { service: id, ok: result.ok, latencyMs: result.latencyMs, message: result.message, checkedAt: data.checkedAt.toISOString() };
}

/**
 * The kill switch. Off: features that use the service show "temporarily unavailable" and wait; nothing is deleted.
 * On from the API needs no confirm; off does (it changes what clients can do), and needs a reason.
 */
export async function setServiceEnabled(ctx: AdminContext, input: { service: string; enabled: boolean; reason?: string; confirm?: boolean }) {
  if (!isServiceId(input.service)) throw new AdminError("not_found", `Unknown service "${input.service}".`);
  const info = serviceInfo(input.service);
  if (!info.killable) throw new AdminError("forbidden", `${info.name} cannot be switched off: ${info.whenOff}`);
  if (typeof input.enabled !== "boolean") throw new AdminError("invalid", "enabled must be true or false.");
  const reason = input.reason?.trim().slice(0, 200) || null;
  if (!input.enabled) {
    if (ctx.viaApi && input.confirm !== true) throw new AdminError("confirm_required", `Switching ${info.name} off changes what clients can do. Send confirm: true to proceed.`);
    if (!reason || reason.length < 3) throw new AdminError("invalid", "Give a short reason for switching a service off (at least 3 characters).");
  }
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.serviceSwitch.findUnique({ where: { service: input.service } });
    const wasEnabled = before ? before.enabled : true;
    const row = await tx.serviceSwitch.upsert({
      where: { service: input.service },
      create: { service: input.service, enabled: input.enabled, reason: input.enabled ? null : reason, changedBy: ctx.actor },
      update: { enabled: input.enabled, reason: input.enabled ? null : reason, changedBy: ctx.actor },
    });
    await writeAudit(tx, ctx, "set_service_enabled", `service:${input.service}`, { enabled: wasEnabled, reason: before?.reason ?? null }, { enabled: row.enabled, reason: row.reason });
    return { service: input.service, enabled: row.enabled, reason: row.reason, changed: wasEnabled !== row.enabled };
  });
  clearSwitchCache();
  return result;
}

// ---- cheap hooks for the Overview "needs your attention" box and the sidebar badges ------------------------

export type ServiceAttention = { key: string; label: string; reason: string };

/**
 * Services that are switched on but not working: the last Test now failed, or a core service's key is missing. Also lists what is
 * switched off (a reminder). Reads only the switches and last test results, so it is cheap enough for every page.
 */
export async function getServicesAttention(): Promise<{ failing: ServiceAttention[]; off: ServiceAttention[] }> {
  const [switches, checks] = await Promise.all([prisma.serviceSwitch.findMany().catch(() => []), prisma.serviceCheck.findMany().catch(() => [])]);
  const off = new Map(switches.filter((s) => !s.enabled).map((s) => [s.service, s]));
  const check = new Map(checks.map((c) => [c.service, c]));
  const failing: ServiceAttention[] = [];
  const paddleSaved = await paddleSavedInSettings();
  const offList: ServiceAttention[] = [];
  for (const info of SERVICES) {
    if (off.has(info.id) && info.killable) {
      offList.push({ key: info.id, label: info.name, reason: `Switched off${off.get(info.id)!.reason ? `: ${off.get(info.id)!.reason}` : ""}` });
      continue;
    }
    const state = configState(info, { paddleSaved });
    // A service that is not set up yet (optional integration without keys) is not failing: Services shows it as
    // "Not connected". Only a core service without its keys is a problem here.
    if (state === "missing") {
      if (isCoreService(info)) failing.push({ key: info.id, label: info.name, reason: `Missing keys: ${info.env.filter((n) => !isSet(n)).join(", ")}` });
    } else if (state !== "not_in_use" && check.get(info.id) && !check.get(info.id)!.ok) failing.push({ key: info.id, label: info.name, reason: `Last test failed: ${check.get(info.id)!.message ?? "no details"}` });
  }
  return { failing, off: offList };
}
