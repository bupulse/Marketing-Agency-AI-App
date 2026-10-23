import { notFound } from "next/navigation";
import { SupportAppProvider } from "@/components/support-app/app-context";
import { SupportBaseProvider } from "@/components/support-app/base";
import { ChatsView } from "@/components/support-app/chats-view";
import { SupportShell } from "@/components/support-app/shell";
import { StatsView } from "@/components/support-app/stats-view";
import { VisitorsView } from "@/components/support-app/visitors-view";
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
  if (!["chats", "visitors", "stats"].includes(which) || (screen?.length ?? 0) > 1) notFound();
  const role = sp.role === "agent" ? "AGENT" : "SUPERVISOR";
  const base = `${await supportBase()}/preview`;
  return (
    <SupportBaseProvider base={base}>
      <SupportAppProvider me={{ ...MOCK_AGENT, role }} preview>
        <SupportShell>
          {which === "visitors" ? <VisitorsView /> : which === "stats" ? <StatsView hoursLabel="Mon–Sat 08:00–20:00 Kigali" /> : <ChatsView initialId={typeof sp.c === "string" ? sp.c : null} />}
        </SupportShell>
      </SupportAppProvider>
    </SupportBaseProvider>
  );
}
