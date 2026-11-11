// The services a person picked at sign-up ("Pick what to start", /apps/start), kept in their Supabase user metadata
// (services_picked), so phase 2 can create the Agency workspace of everyone who asked for it. Pure.
import { SERVICES, type ServiceId } from "./app-hosts";

const IDS = new Set<string>(SERVICES.map((s) => s.id));

export const PICKED_KEY = "services_picked";
export const PICKED_AT_KEY = "services_picked_at";

/** The picked services from user metadata, known ids only, in the services' order. */
export function pickedServices(meta: Record<string, unknown> | null | undefined): ServiceId[] {
  const raw = meta?.[PICKED_KEY];
  const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && IDS.has(v)) : [];
  return SERVICES.map((s) => s.id).filter((id) => list.includes(id));
}

/** True once the person went through the pick step. */
export const hasPicked = (meta: Record<string, unknown> | null | undefined) => Array.isArray(meta?.[PICKED_KEY]);

/** The ids from the pick form (checkbox values), known ids only; never empty when valid. */
export function readPicks(values: unknown[]): ServiceId[] {
  const set = new Set(values.filter((v): v is string => typeof v === "string"));
  return SERVICES.map((s) => s.id).filter((id) => set.has(id));
}

/** A status line for the Marketing card from the company's subscription (cheap: one row). */
export function marketingStatus(sub: { plan: string; status: string; trialEndsAt: Date | null } | null, planName: string | null, now = Date.now()): string | null {
  if (!sub) return null;
  if (sub.status === "PENDING_DEMO") return "Ready to start your free trial";
  if (sub.plan === "TRIAL") {
    if (!sub.trialEndsAt) return "Free trial";
    const days = Math.ceil((sub.trialEndsAt.getTime() - now) / 86_400_000);
    return days > 0 ? `Free trial, ${days} ${days === 1 ? "day" : "days"} left` : "Free trial ended";
  }
  if (sub.status === "CANCELED" || sub.status === "EXPIRED") return "Plan ended";
  if (sub.status === "PAST_DUE") return `${planName ?? sub.plan} plan, payment due`;
  return `${planName ?? sub.plan} plan`;
}
