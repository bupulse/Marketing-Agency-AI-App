import { Settings } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { TestGenerate } from "@/components/app/test-generate";
import { GlassCard } from "@/components/ui";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { email, displayName, businessName } = await getAppContext();
  const rows = [
    ["Name", displayName],
    ["Email", email],
    ["Business", businessName],
  ];

  return (
    <>
      <PageHeader title="Settings" description="Your account and business details." />
      <GlassCard as="dl" className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="truncate text-[15px] font-medium">{value}</dd>
          </div>
        ))}
      </GlassCard>
      <EmptyState
        comingSoon
        icon={Settings}
        title="More settings are coming"
        text="Edit your profile and business, add team members, install the chat widget and manage your account."
        points={["Profile and business details", "Chat widget install snippet", "Delete your account and data"]}
      />
      {process.env.NODE_ENV !== "production" && (
        <GlassCard as="section" aria-labelledby="devchecks" className="flex flex-col gap-3 p-5 sm:p-6">
          <h2 id="devchecks" className="text-lg font-semibold">Developer checks</h2>
          <p className="text-sm text-muted">Only shown outside production.</p>
          <TestGenerate />
        </GlassCard>
      )}
    </>
  );
}
