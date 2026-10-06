import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { TestGenerate } from "@/components/app/test-generate";
import { GlassCard } from "@/components/ui";
import { BusinessSection, ProfileSection } from "@/components/settings/settings-form";
import { DeleteAccount } from "@/components/settings/delete-account";
import { TeamCard } from "@/components/settings/team-card";
import { prisma } from "@/lib/db";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, email, displayName, business, usage } = await getAppContext();
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, signUpMethod: true } });

  return (
    <>
      <PageHeader title="Settings" description="Your account and business details." />
      <ProfileSection
        name={account?.name ?? displayName}
        email={email}
        signInMethod={account?.signUpMethod === "GOOGLE" ? "Google" : "Email and password"}
      />
      <BusinessSection
        defaults={{
          organisationName: business.name,
          ceoName: business.ceoName ?? "",
          industry: business.industry ?? "",
          country: business.country ?? "",
          phone: business.phone ?? "",
          website: business.website ?? "",
        }}
      />
      <TeamCard />
      <DeleteAccount email={email} />
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
