// A company account: an account BuPulse runs for itself or its staff (BuPulse's own company page, LEAF), with every
// feature and no charge. It is an ordinary paid-plan subscription with no payment behind it: ACTIVE on the top plan,
// no billing provider, no provider subscription and no period end. Nothing renews it and nothing ends it: the renewal
// jobs only read Paddle and Mobile Money subscriptions (lib/billing/renewal.ts, momo-renewals.ts), and a plan with no
// period end is always inside its period (lib/billing/period.ts). Every paid path sets a provider, so this shape is only
// ever made by the admin action (lib/admin/service.ts setCompanyAccount), and MRR leaves it out.

/** The plan a company account is put on: every built feature of the app (lib/plans.ts PRO_FEATURES). */
export const COMPANY_ACCOUNT_PLAN = "PRO";

export type CompanyAccountBits = {
  plan: string;
  status: string;
  provider?: string | null;
  providerSubscriptionId?: string | null;
  currentPeriodEnd?: Date | string | null;
};

/** Pure: whether a subscription is a company account (free, never ends, not revenue). */
export function isCompanyAccount(sub: CompanyAccountBits | null | undefined): boolean {
  return Boolean(sub) && sub!.plan !== "TRIAL" && sub!.status === "ACTIVE" && !sub!.provider && !sub!.providerSubscriptionId && !sub!.currentPeriodEnd;
}
