import { BellRing } from "lucide-react";
import { KitStyles, PageHeader } from "@/components/admin/kit";
import { NotificationsCard, type NotificationsCardProps } from "./notifications-card";
import { PushToggle } from "./push-toggle";

/** The lead alerts page (plain data in, so the page and the dev preview draw the same). */
export function LeadAlertsScreen({ push, notifications, backHref = "/dashboard/leads" }: { push: { publicKey: string; registered: string[] } | null; notifications: NotificationsCardProps | null; backHref?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader icon={BellRing} tone="violet" title="Lead alerts" description="Choose how you hear about a new lead, so you can answer while they still want to buy." back={{ href: backHref, label: "Leads" }} />
      <div className="kit-rise flex flex-col gap-4">
        {push && <PushToggle publicKey={push.publicKey} registered={push.registered} />}
        {notifications && <NotificationsCard {...notifications} />}
      </div>
    </div>
  );
}
