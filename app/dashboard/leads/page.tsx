import { Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, GlassCard } from "@/components/ui";
import { prisma } from "@/lib/db";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  const { business } = await getAppContext();
  const leads = business
    ? await prisma.lead.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" }, take: 50 })
    : [];

  return (
    <>
      <PageHeader title="Leads" description="People who got in touch through your website chat widget." />
      {leads.length === 0 ? (
        <EmptyState
          comingSoon
          icon={Users}
          title="Capture leads while you sleep"
          text="Add the BuPulse chat widget to your website. It answers visitor questions and collects their details for you."
          points={[
            "Answers from the facts you provide: hours, area, FAQs",
            "Collects name, contact details and what they want",
            "Get notified and follow up from this page",
          ]}
        />
      ) : (
        <GlassCard as="ul" className="flex flex-col p-3">
          {leads.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl p-3 hover:bg-soft">
              <div className="flex min-w-0 flex-1 basis-56 flex-col">
                <strong className="truncate text-[15px]">{l.name ?? "Visitor"}</strong>
                <span className="truncate text-[13px] text-muted">
                  {[l.email, l.phone].filter(Boolean).join(" · ") || "No contact details"}
                </span>
                {(l.interest ?? l.message) && <span className="truncate text-[13px]">{l.interest ?? l.message}</span>}
              </div>
              <Badge tone="neutral">{l.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Badge>
            </li>
          ))}
        </GlassCard>
      )}
    </>
  );
}
