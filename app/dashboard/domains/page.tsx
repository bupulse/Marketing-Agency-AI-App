import { featureGate, pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { DomainsView } from "@/components/domains/domains-view";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { tokenPageUrl } from "@/lib/cloudflare/client";
import { CloudflareUserError, listZoneRows, type ZoneRow } from "@/lib/cloudflare/service";
import { prisma } from "@/lib/db";
import { scriptTag } from "@/lib/widget/install";

export const metadata = { title: "Your domains" };

export default async function DomainsPage() {
  const blocked = (await pageGate("connectors")) ?? (await featureGate("websiteChat"));
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
  const connected = Boolean(conn && conn.status === "ACTIVE" && !problem);
  // A saved connection that stopped working: say why above the steps.
  const warning = conn && !connected ? (problem ?? "Cloudflare no longer accepts the saved token.") : null;

  return <DomainsView connected={connected} problem={warning} tokenUrl={tokenPageUrl()} zones={zones} snippet={scriptTag(publicSiteUrl(), business.widgetKey)} />;
}
