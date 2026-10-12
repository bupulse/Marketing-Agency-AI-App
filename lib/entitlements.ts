import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { disabledServices, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";
import { prisma } from "@/lib/db";
import { featureLabel, featureOf, type FeatureKey } from "@/lib/features";
import { getPlan } from "@/lib/plan-catalog";
import type { ServiceId } from "@/lib/admin/service-catalog";

// What a company may use: the features of its plan (lib/plan-catalog.ts) whose outside services are switched on
// (lib/admin/switch.ts). Every gated page, server action and route checks here; hiding a sidebar item is only a
// courtesy. Role permissions (lib/team/roles.ts) apply on top: a feature in the plan is still subject to who may use it.

/**
 * Why a feature is not usable: the plan lacks it, its outside services are all off, or the plan could not be resolved
 * ("plan_unknown": the company has no plan key, or the key is not in the catalog, which happens while the catalog is
 * degraded to the seed plans and the company is on a custom plan). Readers must not treat "plan_unknown" as a lost
 * feature: crons skip without changing anything, and the publisher leaves the post to retry.
 */
export type FeatureBlockReason = "not_in_plan" | "service_off" | "plan_unknown";

export const PLAN_UNKNOWN_MESSAGE = "We could not check your plan right now. Please try again in a moment.";

/**
 * Why an account is read-only, whatever its plan says: waiting for its demo, trial over, a failed payment, or a plan
 * that ended (EXPIRED, CANCELED). Mirrors lib/usage.ts, which refuses generation for the same reasons. "Keep your data"
 * stays: pages still render (viewing), export and delete stay open; everything that does something new is refused,
 * crons skip the company, and the publisher holds its posts (lib/publishing/engine.ts).
 */
export type AccountBlock = "pending_demo" | "trial_expired" | "past_due" | "inactive";

export function blockMessage(block: AccountBlock): string {
  switch (block) {
    case "pending_demo":
      return "Your demo comes first: everything opens after your demo and the free trial that follows it.";
    case "trial_expired":
      return "Your free trial has ended. Choose a plan on the Billing page to keep going; everything you made is saved.";
    case "past_due":
      return "Your last payment did not go through. Update your payment on the Billing page to keep creating; everything you made is saved.";
    default:
      return "Your plan is not active. Choose a plan on the Billing page to start again; everything you made is saved.";
  }
}

/** A company (Business.id), or anything that carries one, such as the SessionUser of lib/auth/require-user.ts. */
export type CompanySubject = string | { businessId: string };

const businessIdOf = (subject: CompanySubject) => (typeof subject === "string" ? subject : subject.businessId);

export function notInPlanMessage(feature: FeatureKey): string {
  return `${featureLabel(feature)} is not part of your plan. Add it to your plan to use it.`;
}

/** Thrown by `assertFeature`. `message` is safe to show to a client; routes answer with `featureErrorResponse`. */
export class FeatureRequiredError extends Error {
  constructor(
    public feature: FeatureKey,
    public reason: FeatureBlockReason,
    /** Set when the account as a whole is read-only: the message then says why, not "not in your plan". */
    public block: AccountBlock | null = null,
  ) {
    super(block ? blockMessage(block) : reason === "service_off" ? UNAVAILABLE_MESSAGE : reason === "plan_unknown" ? PLAN_UNKNOWN_MESSAGE : notInPlanMessage(feature));
    this.name = "FeatureRequiredError";
  }
}

type SubscriptionBits = { plan: string; status: string; chosenPlan: string | null; trialEndsAt?: Date | null };

/** The subscription of a company. Cached per request, like getAppContext. */
const subscriptionOf = cache(async (businessId: string): Promise<SubscriptionBits | null> => {
  if (!businessId) return null;
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { user: { select: { subscription: { select: { plan: true, status: true, chosenPlan: true, trialEndsAt: true } } } } },
  });
  const sub = business?.user.subscription;
  return sub ? { plan: sub.plan, status: sub.status, chosenPlan: sub.chosenPlan ?? null, trialEndsAt: sub.trialEndsAt ?? null } : null;
});

/**
 * Which plan's features a company has (pure, so tests can check the rule):
 * - waiting for its demo (PENDING_DEMO): none, whatever the plan says;
 * - on the trial (TRIALING) with a plan chosen at sign-up: the chosen plan's features (the limits stay the TRIAL plan's);
 * - otherwise its plan's.
 */
export function featurePlanKey(sub: SubscriptionBits | null): string | null {
  if (!sub || sub.status === "PENDING_DEMO") return null;
  if (sub.status === "TRIALING" && sub.chosenPlan) return sub.chosenPlan;
  return sub.plan;
}

/** Pure: whether a subscription makes the account read-only right now (see AccountBlock), or null when it may act. */
export function accountBlock(sub: SubscriptionBits | null, now: Date = new Date()): AccountBlock | null {
  if (!sub) return null;
  if (sub.status === "PENDING_DEMO") return "pending_demo";
  if (sub.status === "PAST_DUE") return "past_due";
  if (sub.plan === "TRIAL" && sub.trialEndsAt && sub.trialEndsAt.getTime() < now.getTime()) return "trial_expired";
  if (sub.status !== "ACTIVE" && sub.status !== "TRIALING") return "inactive";
  return null;
}

export type CompanyEntitlements = {
  /** Everything the plan includes. */
  inPlan: Set<FeatureKey>;
  /** The part of the plan that works right now: its outside services are on. */
  usable: Set<FeatureKey>;
  /** False when the company's plan could not be found in the catalog: `inPlan` is then empty but says nothing. */
  resolved: boolean;
  /** Set while the account is read-only (demo pending, trial over, past due, ended): nothing in `usable` may be acted on. */
  block: AccountBlock | null;
};

const serviceUp = (key: FeatureKey, off: Set<ServiceId>) => {
  const services = featureOf(key).services;
  return services.length === 0 || services.some((id) => !off.has(id));
};

/** The reason a company cannot use a feature, from what `companyEntitlements` found. */
export function blockReason(e: Pick<CompanyEntitlements, "inPlan" | "resolved">, key: FeatureKey): FeatureBlockReason {
  return e.inPlan.has(key) ? "service_off" : e.resolved ? "not_in_plan" : "plan_unknown";
}

/** What a company's plan includes and which of those are usable now. One lookup per request. */
export const companyEntitlements = cache(async (businessId: string): Promise<CompanyEntitlements> => {
  const sub = await subscriptionOf(businessId);
  const block = accountBlock(sub);
  const planKey = featurePlanKey(sub);
  // A chosen plan that was retired since falls back to the plan the subscription is on.
  const plan = planKey ? ((await getPlan(planKey)) ?? (sub && planKey !== sub.plan ? await getPlan(sub.plan) : null)) : null;
  const off = await disabledServices();
  // A read-only account keeps its plan's features for viewing; `block` says they may not be acted on. Its answer is
  // definite (resolved), never "plan_unknown": a company waiting for its demo is refused with 403, not 503.
  const inPlan = new Set<FeatureKey>(plan?.features ?? []);
  return { inPlan, usable: new Set([...inPlan].filter((k) => serviceUp(k, off))), resolved: plan !== null || block !== null, block };
});

/** The features a company can use right now. */
export async function companyFeatures(subject: CompanySubject): Promise<Set<FeatureKey>> {
  return (await companyEntitlements(businessIdOf(subject))).usable;
}

/** "ok", or why the feature may not be used now (a read-only account answers "not_in_plan" for everything). */
export async function featureStatus(subject: CompanySubject, key: FeatureKey): Promise<"ok" | FeatureBlockReason> {
  const { inPlan, usable, resolved, block } = await companyEntitlements(businessIdOf(subject));
  if (block) return "not_in_plan";
  return usable.has(key) ? "ok" : inPlan.has(key) ? "service_off" : resolved ? "not_in_plan" : "plan_unknown";
}

/** The error for a feature that may not be used now, or null. Carries the account block so the message says why. */
async function featureError(subject: CompanySubject, key: FeatureKey): Promise<FeatureRequiredError | null> {
  const e = await companyEntitlements(businessIdOf(subject));
  const status = e.block ? "not_in_plan" : e.usable.has(key) ? "ok" : e.inPlan.has(key) ? "service_off" : e.resolved ? "not_in_plan" : "plan_unknown";
  return status === "ok" ? null : new FeatureRequiredError(key, status, e.block);
}

export async function hasFeature(subject: CompanySubject, key: FeatureKey): Promise<boolean> {
  return (await featureStatus(subject, key)) === "ok";
}

/** For server actions and route handlers: throws FeatureRequiredError when the company may not use the feature. */
export async function assertFeature(subject: CompanySubject, key: FeatureKey): Promise<void> {
  const error = await featureError(subject, key);
  if (error) throw error;
}

/** For actions that answer in words (`{ ok: false, error }`): the message when the feature is not usable, else null. */
export async function featureBlocked(subject: CompanySubject, key: FeatureKey): Promise<string | null> {
  return (await featureError(subject, key))?.message ?? null;
}

/**
 * For server components outside the dashboard layout: sends the person to the "Add to your plan" page when the
 * feature is missing. Dashboard pages use `featureGate` (components/app/no-access.tsx), which shows it in place.
 */
export async function requireFeature(subject: CompanySubject, key: FeatureKey): Promise<void> {
  const status = await featureStatus(subject, key);
  if (status !== "ok") redirect(upgradeHref(key, status));
}

export function upgradeHref(key: FeatureKey, reason: FeatureBlockReason = "not_in_plan"): string {
  return `/dashboard/upgrade?feature=${key}${reason === "not_in_plan" ? "" : `&reason=${reason}`}`;
}

/** The JSON answer of a route for a FeatureRequiredError: 403 for a feature not in the plan, 503 while its service is off or the plan cannot be checked. */
export function featureErrorResponse(error: FeatureRequiredError): NextResponse {
  const status = error.reason === "not_in_plan" ? 403 : 503;
  return NextResponse.json({ error: "feature_required", feature: error.feature, reason: error.reason, message: error.message }, { status, headers: { "cache-control": "no-store" } });
}
