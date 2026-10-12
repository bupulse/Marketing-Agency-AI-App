import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { CustomPlanForm } from "@/components/offers/custom-plan-form";
import { checkActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { isFeatureKey } from "@/lib/features";
import { askMessage, can } from "@/lib/team/roles";
import { REQUEST_SOURCES, type RequestSource } from "@/lib/offers/shared";

export const metadata: Metadata = {
  title: "Request a custom plan",
  robots: { index: false, follow: false },
};

// "Need something different? Request a custom plan" from the pricing page, Billing, "Add to your plan" and the demo
// screen (docs/OFFERS.md). Signed-in companies only (a visitor signs up first; proxy.ts sends them to sign in), in any
// state, including while waiting for the demo, so the request can be talked through in the demo call.
export default async function CustomPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const check = await checkActiveUser();
  if (check.status === "signed_out") redirect(`/signup?next=${encodeURIComponent("/custom-plan")}`);
  if (check.status === "unconfirmed") redirect("/login?error=confirm");
  if (check.status === "suspended") redirect("/suspended");
  if (check.status === "locked") redirect("/account/deletion");
  const user = check.user;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const from = one(sp.from);
  const source: RequestSource = (REQUEST_SOURCES as readonly string[]).includes(from) ? (from as RequestSource) : "billing";
  const feature = one(sp.feature);
  const business = user.businessId
    ? await prisma.business.findUnique({ where: { id: user.businessId }, select: { name: true, description: true, industryDescription: true, phone: true, detailsCompletedAt: true, onboardedAt: true, user: { select: { subscription: { select: { status: true } } } } } })
    : null;
  // A brand-new account finishes /welcome and /onboarding first; the return cookie set when the sign-up email was
  // confirmed (lib/auth/return-path.ts) brings it back here afterwards.
  if (!business?.detailsCompletedAt) redirect("/welcome");
  if (!business.onboardedAt) redirect("/onboarding");
  const pendingDemo = business.user?.subscription?.status === "PENDING_DEMO";
  const back = pendingDemo ? { href: "/dashboard", label: "Back to your demo" } : { href: "/dashboard/billing", label: "Back to Billing" };

  return (
    <OnboardingShell>
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-medium text-muted">{business.name}</p>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Request a custom plan</h1>
        <p className="text-[15px] text-muted">
          Tell us what your business does and what you want from BuPulse. We put together a plan with only what you need and send you an offer to accept in Billing.
          {pendingDemo ? " We will also talk it through in your demo." : ""}
        </p>
      </div>
      {can(user.role, "billing") ? (
        <CustomPlanForm
          source={source}
          initial={{ description: business.description ?? business.industryDescription ?? "", phone: business.phone ?? "", features: isFeatureKey(feature) ? [feature] : [] }}
          back={back}
        />
      ) : (
        <p className="rounded-2xl bg-soft px-4 py-3 text-[15px]">{askMessage("billing")}</p>
      )}
      <Link href={back.href} className="inline-flex min-h-11 items-center text-sm font-medium underline">
        {back.label}
      </Link>
    </OnboardingShell>
  );
}
