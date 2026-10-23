import { notFound } from "next/navigation";
import { StatsView } from "@/components/support-app/stats-view";
import { requireSupportAgentPage } from "@/lib/support/app-auth";
import { getSupportSettings, hoursSummary } from "@/lib/support/settings";

export const metadata = { title: "Stats" };

/** Supervisors only; an agent gets "not found". */
export default async function SupportStatsPage() {
  const me = await requireSupportAgentPage();
  if (me.role !== "SUPERVISOR") notFound();
  return <StatsView hoursLabel={hoursSummary(await getSupportSettings())} />;
}
