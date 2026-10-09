import { NextResponse } from "next/server";
import { featureLabel, type FeatureKey } from "@/lib/features";

// A stand-in for lib/entitlements.ts: every feature is in the plan unless a test puts it in `missing`.
// Use with `vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));` in tests whose database
// mock does not carry plans, so the real lookup (business -> subscription -> plan) is not needed.

export const missing = new Set<FeatureKey>();
export const serviceOff = new Set<FeatureKey>();
/** Set `planUnknown` to true to act as a company whose plan cannot be resolved (catalog degraded, unknown key). */
export const state = { planUnknown: false };

export type FeatureBlockReason = "not_in_plan" | "service_off" | "plan_unknown";

export const PLAN_UNKNOWN_MESSAGE = "We could not check your plan right now. Please try again in a moment.";

export function notInPlanMessage(feature: FeatureKey): string {
  return `${featureLabel(feature)} is not part of your plan. Add it to your plan to use it.`;
}

export class FeatureRequiredError extends Error {
  constructor(
    public feature: FeatureKey,
    public reason: FeatureBlockReason,
  ) {
    super(reason === "service_off" ? "This feature is temporarily unavailable. Please try again later." : reason === "plan_unknown" ? PLAN_UNKNOWN_MESSAGE : notInPlanMessage(feature));
    this.name = "FeatureRequiredError";
  }
}

const status = (key: FeatureKey): "ok" | FeatureBlockReason => (state.planUnknown ? "plan_unknown" : missing.has(key) ? "not_in_plan" : serviceOff.has(key) ? "service_off" : "ok");

export async function companyEntitlements() {
  const all = state.planUnknown ? [] : (await import("@/lib/features")).FEATURE_KEYS.filter((k) => !missing.has(k));
  return { inPlan: new Set(all), usable: new Set(all.filter((k) => !serviceOff.has(k))), resolved: !state.planUnknown };
}
export function blockReason(e: { inPlan: Set<FeatureKey>; resolved: boolean }, key: FeatureKey): FeatureBlockReason {
  return e.inPlan.has(key) ? "service_off" : e.resolved ? "not_in_plan" : "plan_unknown";
}
export async function companyFeatures() {
  return (await companyEntitlements()).usable;
}
export async function featureStatus(_subject: unknown, key: FeatureKey) {
  return status(key);
}
export async function hasFeature(_subject: unknown, key: FeatureKey) {
  return status(key) === "ok";
}
export async function assertFeature(_subject: unknown, key: FeatureKey) {
  const s = status(key);
  if (s !== "ok") throw new FeatureRequiredError(key, s);
}
export async function featureBlocked(_subject: unknown, key: FeatureKey) {
  const s = status(key);
  return s === "ok" ? null : new FeatureRequiredError(key, s).message;
}
export async function requireFeature(_subject: unknown, key: FeatureKey) {
  const s = status(key);
  if (s !== "ok") throw new Error(`NEXT_REDIRECT ${upgradeHref(key, s)}`);
}
export function upgradeHref(key: FeatureKey, reason: FeatureBlockReason = "not_in_plan") {
  return `/dashboard/upgrade?feature=${key}${reason === "not_in_plan" ? "" : `&reason=${reason}`}`;
}
export function featureErrorResponse(error: FeatureRequiredError) {
  return NextResponse.json({ error: "feature_required", feature: error.feature, reason: error.reason, message: error.message }, { status: error.reason === "not_in_plan" ? 403 : 503 });
}
