import "server-only";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/ai/types";
import { NETWORK_SERVICE, SERVICES, serviceInfo, type ServiceId } from "./service-catalog";
import { loadServiceKeys } from "./service-keys";

// The kill switch. A missing ServiceSwitch row means "on", except for services that are off until switched on
// (`defaultOff`, e.g. WhatsApp): for those only a row with enabled = true means on. Reads are cached for a few seconds
// per isolate and fail open: if the database cannot be read, features keep working rather than everything going dark
// (a default-off service stays off).

const DEFAULT_OFF: ServiceId[] = SERVICES.filter((s) => s.defaultOff).map((s) => s.id);

export const UNAVAILABLE_MESSAGE = "This feature is temporarily unavailable. Please try again later.";
const TTL_MS = 15_000;

let cache: { at: number; off: Set<ServiceId> } | null = null;

export function clearSwitchCache() {
  cache = null;
}

/** Services that are switched off right now. */
export async function disabledServices(): Promise<Set<ServiceId>> {
  // Every feature asks the switch before it uses its service, so this is where the keys saved in Admin -> Services
  // reach it (lib/admin/service-keys.ts; cached and never throws).
  await loadServiceKeys();
  if (cache && Date.now() - cache.at < TTL_MS) return cache.off;
  try {
    const rows: { service: string; enabled?: boolean }[] =
      (await prisma.serviceSwitch.findMany({ where: { OR: [{ enabled: false }, { service: { in: DEFAULT_OFF } }] }, select: { service: true, enabled: true } })) ?? [];
    const switchedOn = new Set(rows.filter((r) => r.enabled === true).map((r) => r.service));
    const off = [...rows.filter((r) => r.enabled !== true).map((r) => r.service as ServiceId), ...DEFAULT_OFF.filter((id) => !switchedOn.has(id))];
    cache = { at: Date.now(), off: new Set(off.filter((id) => serviceInfo(id)?.killable)) };
  } catch {
    // Keep the last good answer and wait a full interval before asking again, so an outage is not hit on every call.
    cache = { at: Date.now(), off: cache?.off ?? new Set(DEFAULT_OFF) };
    return cache.off;
  }
  return cache.off;
}

export async function isServiceEnabled(id: ServiceId): Promise<boolean> {
  return !(await disabledServices()).has(id);
}

/** Thrown by a feature that needs a switched-off service. `message` is safe to show to a client. */
export class ServiceDisabledError extends AIProviderError {
  constructor(public service: ServiceId) {
    super(UNAVAILABLE_MESSAGE, service, true);
  }
}

export async function assertServiceEnabled(id: ServiceId): Promise<void> {
  if (!(await isServiceEnabled(id))) throw new ServiceDisabledError(id);
}

/** The service behind text generation (AI_TEXT_PROVIDER). */
export function textAiService(): ServiceId {
  return (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase() === "claude" ? "claude" : "gemini";
}

/** Networks whose service is off: their posts are not claimed, so they stay scheduled. */
export async function disabledNetworks(): Promise<string[]> {
  const off = await disabledServices();
  if (off.size === 0) return [];
  return Object.entries(NETWORK_SERVICE).filter(([, service]) => off.has(service)).map(([network]) => network);
}
