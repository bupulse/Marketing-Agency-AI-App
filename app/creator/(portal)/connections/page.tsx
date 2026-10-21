import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CircleCheck } from "lucide-react";
import { Badge, Button, buttonClasses, GlassCard } from "@/components/ui";
import { PagePicker } from "@/components/creators/portal/page-picker";
import { requireCreator } from "@/lib/creators/auth";
import { CREATOR_CONNECT_ERRORS, type CreatorConnectError } from "@/lib/creators/connect-errors";
import { creatorNetworkReady } from "@/lib/creators/connect-flow";
import { CREATOR_NETWORKS, NETWORK_ACCOUNT, NETWORK_LABEL, networkLabel } from "@/lib/creators/describe";
import { prisma } from "@/lib/db";
import { openPending } from "@/lib/social/oauth";
import { disconnectAction } from "../actions";

export const metadata: Metadata = { title: "Connections" };

const STATUS: Record<string, { label: string; tone: "success" | "danger" | "neutral" }> = {
  ACTIVE: { label: "Connected", tone: "success" },
  EXPIRED: { label: "Connect again", tone: "danger" },
  REVOKED: { label: "Disconnected", tone: "neutral" },
};

export default async function ConnectionsPage({ searchParams }: PageProps<"/creator/connections">) {
  const query = await searchParams;
  const session = await requireCreator();
  const connections = await prisma.creatorConnection.findMany({ where: { profileId: session.profile.id }, orderBy: { createdAt: "asc" } });
  const error = typeof query.error === "string" && query.error in CREATOR_CONNECT_ERRORS ? CREATOR_CONNECT_ERRORS[query.error as CreatorConnectError] : null;
  const connected = typeof query.connected === "string" ? networkLabel(query.connected) : null;
  const jar = await cookies();
  const pending = query.pick === "facebook" ? await openPending((name) => jar.get(name)?.value, session.userId) : null;

  return (
    <>
      <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Connections</h1>
      <p className="text-[15px] text-muted">
        Connect the accounts you post from. BuPulse reads your posts&apos; views from them, through BuPulse-Socials, and never posts anything. Only posts of a connected account count.
      </p>
      {error && <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      {connected && !error && (
        <p role="status" className="flex items-center gap-2 rounded-field bg-success-bg px-4 py-3 text-sm font-medium text-success">
          <CircleCheck aria-hidden className="size-4" /> {connected} is connected.
        </p>
      )}
      {pending?.network === "facebook" && <PagePicker pages={pending.result.accounts.map((a) => ({ id: a.externalAccountId, name: a.displayName }))} />}

      {CREATOR_NETWORKS.map((network) => {
        const mine = connections.filter((c) => c.network === network);
        return (
          <GlassCard key={network} padding="none" className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold">{NETWORK_LABEL[network]}</h2>
                <p className="text-sm text-muted">{NETWORK_ACCOUNT[network]}</p>
              </div>
              {/* A plain link: the connect route starts a sign-in, so it must never be prefetched. */}
              {!creatorNetworkReady(network) ? (
                <Badge tone="neutral">Coming soon</Badge>
              ) : (
              <a href={`/api/creator/${network}/connect`} className={buttonClasses({ size: "sm", variant: mine.some((c) => c.status === "ACTIVE") ? "outline" : "primary" })}>
                {mine.length ? (network === "facebook" ? "Connect a Page" : "Connect again") : "Connect"}
              </a>
              )}
            </div>
            {mine.map((c) => {
              const s = STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-soft p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {c.avatarUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- the network's own picture URL
                      <img src={c.avatarUrl} alt="" className="size-9 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{c.displayName ?? c.username ?? c.externalAccountId}</p>
                      {c.status === "EXPIRED" && <p className="text-xs text-muted">Connect it again within 3 days, or its posts stop earning.</p>}
                      {c.status === "REVOKED" && <p className="text-xs text-muted">Its posts stop earning 3 days after it was disconnected.</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {c.status !== "REVOKED" && (
                      <form action={disconnectAction}>
                        <input type="hidden" name="connectionId" value={c.id} />
                        <Button type="submit" size="sm" variant="outline">Disconnect</Button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </GlassCard>
        );
      })}
    </>
  );
}
