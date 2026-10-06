import { Palette } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { GlassCard } from "@/components/ui";

export const metadata = { title: "Brand" };

export default async function BrandPage() {
  const { business, businessName } = await getAppContext();
  const rows = [
    ["Business", businessName],
    ["Industry", business?.industry],
    ["Brand voice", business?.tone],
    ["Website", business?.website],
  ];

  return (
    <>
      <PageHeader title="Brand" description="Your name, voice, logo and colours. Everything BuPulse creates is based on this." />
      <GlassCard as="dl" className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="truncate text-[15px] font-medium">{value || "Not set yet"}</dd>
          </div>
        ))}
      </GlassCard>
      <EmptyState
        comingSoon
        icon={Palette}
        title="Set up your brand profile"
        text="Soon you will be able to describe your business, pick a voice, and upload your logo and colours in a few minutes."
        points={[
          "What you sell and who it is for",
          "Brand voice with example posts",
          "Logo and colours applied to every design",
        ]}
      />
    </>
  );
}
