import { notFound } from "next/navigation";
import { AnalyticsView } from "@/components/support-app/analytics/analytics-view";
import { previewVisitorAnalytics } from "@/components/support-app/analytics/preview-data";
import { SupportAppProvider } from "@/components/support-app/app-context";
import { SupportBaseProvider } from "@/components/support-app/base";
import { ChatsView } from "@/components/support-app/chats-view";
import { SupportShell } from "@/components/support-app/shell";
import { StatsView } from "@/components/support-app/stats-view";
import { VisitorsView } from "@/components/support-app/visitors-view";
import { LinksView } from "@/components/support-app/links-view";
import { ServerView } from "@/components/support-app/server/server-view";
import { parseServerState, previewServerMonitor } from "@/components/support-app/server/preview-data";
import { TeamView } from "@/components/support-app/team-view";
import { previewTeam } from "@/components/support-app/team/preview-data";
import { previewLinksReport } from "@/components/support-app/links-preview-data";
import { utcDay } from "@/lib/analytics/collect";
import { parseVisitorPeriod, recentMonths } from "@/lib/analytics/visitors-shared";
import { supportBase } from "@/lib/support/app-auth";
import { MOCK_AGENT } from "@/lib/support/app-client/mock";
import { previewAllowed } from "@/lib/support/preview";

export const metadata = { title: "Preview" };

/**
 * Development only: the support app's screens with made-up data (lib/support/app-client/mock.ts), no sign-in and no
 * server, for checking the design in a browser. Not found in production.
 */
export default async function SupportPreviewPage({ params, searchParams }: PageProps<"/support/preview/[[...screen]]">) {
  if (!previewAllowed()) notFound();
  const [{ screen }, sp] = await Promise.all([params, searchParams]);
  const which = screen?.[0] ?? "chats";
  if (!["chats", "visitors", "analytics", "stats", "links", "server", "team"].includes(which) || (screen?.length ?? 0) > 1) notFound();
  // ?role=agent or ?role=tech; the default supervisor is also the owner (admin@), so every nav item shows.
  const role = sp.role === "agent" ? "AGENT" : sp.role === "tech" ? "TECH" : "SUPERVISOR";
  const base = `${await supportBase()}/preview`;
  return (
    <SupportBaseProvider base={base}>
      <SupportAppProvider me={{ ...MOCK_AGENT, role, owner: role === "SUPERVISOR" }} preview>
        <SupportShell>
          {which === "server" ? (
            <ServerView m={previewServerMonitor(parseServerState(sp.state))} preview />
          ) : which === "team" ? (
            <TeamView {...previewTeam()} preview />
          ) : which === "visitors" ? <VisitorsView /> : which === "analytics" ? (
            <AnalyticsView data={previewVisitorAnalytics(parseVisitorPeriod(sp))} period={parseVisitorPeriod(sp)} href={`${base}/analytics`} liveHref={`${base}/visitors`} months={recentMonths()} today={utcDay(new Date())} />
          ) : which === "links" ? (
            <LinksView report={previewLinksReport(role === "SUPERVISOR")} owner={role === "SUPERVISOR"} period={parseVisitorPeriod(sp)} href={`${base}/links`} months={recentMonths()} today={utcDay(new Date())} site="https://bupulse.com" />
          ) : which === "stats" ? <StatsView hoursLabel="Mon–Sat 08:00–20:00 Kigali" /> : <ChatsView initialId={typeof sp.c === "string" ? sp.c : null} />}
        </SupportShell>
      </SupportAppProvider>
    </SupportBaseProvider>
  );
}
