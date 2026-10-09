import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, GlassCard } from "@/components/ui";
import { TokenForm } from "@/components/domains/token-form";
import { ZoneList } from "@/components/domains/zone-list";
import { siteUrl } from "@/lib/auth/site-url";
import { tokenPageUrl } from "@/lib/cloudflare/client";
import { CloudflareUserError, listZoneRows, type ZoneRow } from "@/lib/cloudflare/service";
import { prisma } from "@/lib/db";
import { scriptTag } from "@/lib/widget/install";
import { DisconnectCloudflareButton } from "@/components/domains/disconnect-button";

export const metadata = { title: "Your domains" };

export default async function DomainsPage() {
  const blocked = await pageGate("connectors");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  if (!business) return null;
  const conn = await prisma.cloudflareConnection.findUnique({ where: { businessId: business.id }, select: { status: true } });
  let zones: ZoneRow[] = [];
  let problem: string | null = null;
  if (conn && conn.status === "ACTIVE") {
    try {
      zones = await listZoneRows(business.id);
    } catch (error) {
      problem = error instanceof CloudflareUserError ? error.message : "We could not load your domains right now.";
    }
  }

  return (
    <>
      <PageHeader title="Your domains" description="Connect Cloudflare to see your domains and add the BuPulse chat to a website in one click." />
      {!conn || conn.status !== "ACTIVE" || problem ? (
        <GlassCard className="flex flex-col gap-5">
          {conn && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] text-danger">{problem ?? "Cloudflare no longer accepts the saved token."} Paste a new token below.</p>}
          <h2 className="text-lg font-semibold">Connect Cloudflare</h2>
          <ol className="list-decimal space-y-2 pl-5 text-[14px]">
            <li>
              <a href={tokenPageUrl()} target="_blank" rel="noopener noreferrer" className="font-semibold text-pulse-blue">Open Cloudflare&apos;s token page</a> (it opens with the right permissions ticked).
            </li>
            <li>
              Check these two permissions are listed: <strong>Zone, Zone, Read</strong> and <strong>Zone, Zaraz, Edit</strong>. If not, add them with &quot;Add more&quot;. Leave &quot;Zone Resources&quot; on <em>All zones</em> (or choose just your site).
            </li>
            <li>Click <strong>Continue to summary</strong>, then <strong>Create Token</strong>, and copy the token. Cloudflare shows it only once.</li>
            <li>Paste it below. BuPulse keeps it encrypted and never shows it again.</li>
          </ol>
          <TokenForm />
        </GlassCard>
      ) : (
        <>
          <GlassCard padding="sm" className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><strong>Cloudflare</strong><Badge tone="success">Connected</Badge></div>
            <DisconnectCloudflareButton />
          </GlassCard>
          <ZoneList zones={zones} snippet={scriptTag(siteUrl(), business.widgetKey)} />
          <p className="px-1 text-[13px] text-muted">
            Installing adds a small &quot;Custom HTML&quot; tool in your domain&apos;s Zaraz settings and the domain to your chat&apos;s allowed websites. Remove undoes it. Disconnecting keeps chats that are already installed.
          </p>
        </>
      )}
    </>
  );
}
