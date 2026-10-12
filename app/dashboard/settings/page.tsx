import { Suspense } from "react";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { TestGenerate } from "@/components/app/test-generate";
import { GlassCard } from "@/components/ui";
import { BusinessSection, ProfileSection } from "@/components/settings/settings-form";
import { DeleteAccount } from "@/components/settings/delete-account";
import { TeamCard } from "@/components/settings/team-card";
import { CanvaCard } from "@/components/settings/canva-card";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { prisma } from "@/lib/db";
import { can } from "@/lib/team/roles";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { actorId, role, email, displayName, business, usage } = await getAppContext();
  const [account, members] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { name: true, signUpMethod: true } }),
    prisma.membership.count({ where: { businessId: business.id } }),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Your account and business details." />
      <Suspense>
        <CanvaReturnToast />
      </Suspense>
      <ProfileSection
        name={account?.name ?? displayName}
        email={email}
        signInMethod={account?.signUpMethod === "GOOGLE" ? "Google" : "Email and password"}
      />
      {can(role, "settings") && (
      <BusinessSection
        country={business.country ?? ""}
        industryLabel={business.industry ?? ""}
        defaults={{
          organisationName: business.name,
          ceoName: business.ceoName ?? "",
          phone: formatPhone(business.phone),
          website: business.website ?? "",
        }}
      />
      )}
      <CanvaCard userId={actorId} />
      <TeamCard role={role} canManage={can(role, "team")} members={members} />
      <DeleteAccount email={email} wholeCompany={role === "OWNER"} teammates={members - 1} />
      {process.env.NODE_ENV !== "production" && (
        <GlassCard as="section" aria-labelledby="devchecks" className="flex flex-col gap-3 p-5 sm:p-6">
          <h2 id="devchecks" className="text-lg font-semibold">Developer checks</h2>
          <p className="text-sm text-muted">Only shown outside production.</p>
          <TestGenerate limit={usage.limits.text} resetsAt={usage.resetsAt?.toISOString() ?? null} />
        </GlassCard>
      )}
    </>
  );
}
