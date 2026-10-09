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

export type FeatureBlockReason = "not_in_plan" | "service_off";

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
  ) {
    super(reason === "service_off" ? UNAVAILABLE_MESSAGE : notInPlanMessage(feature));
    this.name = "FeatureRequiredError";
  }
}

/** The plan key of a company. Cached per request, like getAppContext. */
const planKeyOf = cache(async (businessId: string): Promise<string | null> => {
  if (!businessId) return null;
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { user: { select: { subscription: { select: { plan: true } } } } },
  });
  return business?.user.subscription?.plan ?? null;
});

export type CompanyEntitlements = {
  /** Everything the plan includes. */
  inPlan: Set<FeatureKey>;
  /** The part of the plan that works right now: its outside services are on. */
  usable: Set<FeatureKey>;
};

const serviceUp = (key: FeatureKey, off: Set<ServiceId>) => {
  const services = featureOf(key).services;
  return services.length === 0 || services.some((id) => !off.has(id));
};

/** What a company's plan includes and which of those are usable now. One lookup per request. */
export const companyEntitlements = cache(async (businessId: string): Promise<CompanyEntitlements> => {
  const planKey = await planKeyOf(businessId);
  const plan = planKey ? await getPlan(planKey) : null;
  const off = await disabledServices();
  const inPlan = new Set<FeatureKey>(plan?.features ?? []);
  return { inPlan, usable: new Set([...inPlan].filter((k) => serviceUp(k, off))) };
});

/** The features a company can use right now. */
export async function companyFeatures(subject: CompanySubject): Promise<Set<FeatureKey>> {
  return (await companyEntitlements(businessIdOf(subject))).usable;
}

/** "ok", or why the feature is not usable. */
export async function featureStatus(subject: CompanySubject, key: FeatureKey): Promise<"ok" | FeatureBlockReason> {
  const { inPlan, usable } = await companyEntitlements(businessIdOf(subject));
  return usable.has(key) ? "ok" : inPlan.has(key) ? "service_off" : "not_in_plan";
}

export async function hasFeature(subject: CompanySubject, key: FeatureKey): Promise<boolean> {
  return (await featureStatus(subject, key)) === "ok";
}

/** For server actions and route handlers: throws FeatureRequiredError when the company may not use the feature. */
export async function assertFeature(subject: CompanySubject, key: FeatureKey): Promise<void> {
  const status = await featureStatus(subject, key);
  if (status !== "ok") throw new FeatureRequiredError(key, status);
}

/** For actions that answer in words (`{ ok: false, error }`): the message when the feature is not usable, else null. */
export async function featureBlocked(subject: CompanySubject, key: FeatureKey): Promise<string | null> {
  const status = await featureStatus(subject, key);
  return status === "ok" ? null : new FeatureRequiredError(key, status).message;
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
  return `/dashboard/upgrade?feature=${key}${reason === "service_off" ? "&reason=service_off" : ""}`;
}

/** The JSON answer of a route for a FeatureRequiredError: 403 for a feature not in the plan, 503 while its service is off. */
export function featureErrorResponse(error: FeatureRequiredError): NextResponse {
  const status = error.reason === "service_off" ? 503 : 403;
  return NextResponse.json({ error: "feature_required", feature: error.feature, reason: error.reason, message: error.message }, { status, headers: { "cache-control": "no-store" } });
}
