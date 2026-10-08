import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { initialValues } from "@/components/brand-profile/initial";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { prisma } from "@/lib/db";
import { ensureAccount } from "@/lib/account";
import { isOwnLogoPath, readKnowledge } from "@/lib/brand/schemas";
import { createSignedDownloadUrl } from "@/lib/storage";
import { getCurrentUser } from "@/lib/supabase/server";
import { readReturn } from "@/lib/auth/return-server";

export const metadata: Metadata = {
  title: "Set up your brand",
  robots: { index: false, follow: false },
};

// New accounts land here until the brand onboarding is finished.
export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/onboarding");
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");

  const [business, account] = await Promise.all([
    prisma.business.findUnique({ where: { userId: user.id } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true } }),
  ]);
  if (account?.deletionScheduledFor) redirect("/account/deletion");
  if (!business?.detailsCompletedAt) redirect("/welcome");
  if (business.onboardedAt) redirect(await readReturn());

  const knowledge = readKnowledge(business.knowledge);
  const hasKnowledge = !!(knowledge.hours || knowledge.area || knowledge.contact || knowledge.faqs.length);
  const hasLook = !!business.logoUrl || business.brandColors.length > 0;
  // Resume at the first unfinished step. Logo and colours can be skipped, so a skipped step 3 shows again.
  const initialStep = !business.description || !business.audience ? 1 : !business.tone ? 2 : hasKnowledge || hasLook ? 4 : 3;

  let savedLogoUrl: string | null = null;
  if (business.logoUrl && isOwnLogoPath(user.id, business.logoUrl)) {
    try {
      savedLogoUrl = await createSignedDownloadUrl("brand", business.logoUrl);
    } catch {
      // The file is gone from storage; the step shows the upload prompt instead.
    }
  }

  return (
    <OnboardingShell>
      <OnboardingWizard
        initial={initialValues(business)}
        initialStep={initialStep}
        context={{ businessName: business.name, industry: business.industry, savedLogoUrl }}
      />
    </OnboardingShell>
  );
}
