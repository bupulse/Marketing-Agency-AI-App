import { prisma } from "@/lib/db";
import { disconnectCloudflare } from "@/lib/cloudflare/service";
import type { ConnectorEntry } from "../types";

export const connector: ConnectorEntry = {
  id: "cloudflare",
  name: "Cloudflare",
  group: "website",
  description: "See your domains and add the BuPulse chat to your website in one click.",
  icon: "Globe",
  async status({ businessId }) {
    const row = await prisma.cloudflareConnection.findUnique({ where: { businessId }, select: { status: true, _count: { select: { installs: true } } } });
    if (!row) return { state: "not_connected" };
    if (row.status !== "ACTIVE") return { state: "needs_attention", detail: "The token stopped working. Paste a new one." };
    const n = row._count.installs;
    return { state: "connected", accountLabel: n ? `Chat on ${n} ${n === 1 ? "site" : "sites"}` : "Connected" };
  },
  connectHref: "/dashboard/domains",
  manageHref: "/dashboard/domains",
  async disconnect({ businessId }) {
    await disconnectCloudflare(businessId);
  },
};
