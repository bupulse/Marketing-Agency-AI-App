import { BellRing, Users } from "lucide-react";
import type { ComponentProps } from "react";
import { EmptyState } from "@/components/app/empty-state";
import { KitStyles, PageHeader } from "@/components/admin/kit";
import { LinkRow } from "@/components/app/kit/c-link-row";
import { Button, GlassCard } from "@/components/ui";
import { LeadsInbox } from "./leads-inbox";

/**
 * The Leads page (plain data in, so the page and the dev preview draw the same): the header, a note when website chat
 * is not usable, the inbox (or how leads arrive), and one card to the lead alerts, which have their own page
 * (/dashboard/leads/alerts) so this page stays about the leads.
 */
export function LeadsScreen({
  chatOn,
  inPlan,
  addChatHref,
  inbox,
  alerts,
  alertsHref = "/dashboard/leads/alerts",
}: {
  chatOn: boolean;
  inPlan: boolean;
  /** Where "Add website chat" leads (the plan upgrade). */
  addChatHref: string;
  /** The inbox's data, or null while the company has no lead yet. */
  inbox: ComponentProps<typeof LeadsInbox> | null;
  /** How the owner hears about new leads, for the alerts card; null hides it (no right to change settings). */
  alerts: { summary: string } | null;
  alertsHref?: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader
        icon={Users}
        title="Leads"
        description="People who left their details in your website chat. Call or message them, then mark how it went."
        actions={alerts ? <Button href={alertsHref} variant="outline" size="sm" leading={<BellRing aria-hidden className="size-4" />}>Alerts</Button> : undefined}
      />
      {!chatOn && (
        <GlassCard role="note" className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-[14px]">
            {inPlan
              ? "Website chat is paused for a short while. Your leads stay here to look at, export or delete; status and notes can be changed again once it is back."
              : "Website chat is not part of your plan. Your leads stay here to look at, export or delete; add website chat to collect new ones and work them."}
          </p>
          {!inPlan && (
            <Button href={addChatHref} size="sm">
              Add website chat
            </Button>
          )}
        </GlassCard>
      )}
      {inbox ? (
        <LeadsInbox {...inbox} />
      ) : (
        <EmptyState
          icon={Users}
          title="No leads yet"
          text="Leads arrive when a visitor chats with the BuPulse widget on your website and leaves their details. Each one shows up here and in your email."
          points={["Add the chat widget to your website", "It answers from the facts you gave it, then asks for contact details", "You get an email, and can follow up from this page"]}
          action={<Button href="/dashboard/widget">Set up website chat</Button>}
        />
      )}
      {alerts && (
        <LinkRow href={alertsHref} icon={BellRing} tone="violet" title="Lead alerts" hint={<><span className="sm:hidden">{alerts.summary}. </span>How you hear about a new lead.</>} value={alerts.summary} />
      )}
    </div>
  );
}

/** "Email and daily summary": the alerts that are on, in words. */
export function alertsSummary(on: { instant: boolean; daily: boolean; whatsapp: boolean; devices: number }): string {
  const parts = [on.instant && "Email", on.daily && "Daily summary", on.devices > 0 && (on.devices === 1 ? "1 phone" : `${on.devices} phones`), on.whatsapp && "WhatsApp"].filter(Boolean) as string[];
  if (!parts.length) return "All off";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)!.toLowerCase().replace(/^whatsapp$/, "WhatsApp")}`;
}
