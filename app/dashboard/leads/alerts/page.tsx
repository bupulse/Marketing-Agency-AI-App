import { redirect } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { LeadAlertsScreen } from "@/components/leads/lead-alerts-screen";
import { can } from "@/lib/team/roles";
import { getNotificationSettings } from "@/lib/leads/settings";
import { whatsappAlertsAvailable } from "@/lib/leads/whatsapp";
import { deviceEndpoints, pushPublicKey } from "@/lib/push/service";

export const metadata = { title: "Lead alerts" };

/**
 * How the owner hears about new leads (moved off the Leads page so it stays about the leads, 12 November 2026): phone
 * alerts on this device for everyone, email, the daily summary and WhatsApp for people who may change settings. The
 * same checks the Leads page made before.
 */
export default async function LeadAlertsPage() {
  const blocked = await featureGate("websiteChat");
  if (blocked) return blocked;
  const { business, email, role, actorId } = await getAppContext();
  const canSettings = can(role, "settings");
  const pushKey = pushPublicKey();
  if (!canSettings && !pushKey) redirect("/dashboard/leads");
  const settings = canSettings ? await getNotificationSettings(business.id) : null;
  const [devices, whatsappOn] = await Promise.all([pushKey ? deviceEndpoints(business.id, actorId) : [], settings ? whatsappAlertsAvailable() : false]);
  return (
    <LeadAlertsScreen
      push={pushKey ? { publicKey: pushKey, registered: devices } : null}
      notifications={settings ? { initial: settings, email, whatsapp: whatsappOn ? { enabled: settings.notifyWhatsapp, number: settings.whatsappNumber, fallback: business.phone } : null } : null}
    />
  );
}
