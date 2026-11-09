import { notFound } from "next/navigation";
import { ServerView } from "@/components/support-app/server/server-view";
import { getServerMonitor } from "@/lib/monitor/dashboard";
import { requireSupportAgentPage } from "@/lib/support/app-auth";
import { canSeeMonitoring } from "@/lib/support/roles";

export const metadata = { title: "Server" };

/** Server monitoring: technical staff and supervisors only; anyone else gets "not found". */
export default async function SupportServerPage() {
  const me = await requireSupportAgentPage();
  if (!canSeeMonitoring(me.role)) notFound();
  return <ServerView m={await getServerMonitor()} />;
}
