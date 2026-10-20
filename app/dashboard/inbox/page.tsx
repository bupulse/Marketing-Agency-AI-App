import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { InboxView } from "@/components/inbox/inbox-view";
import { Button } from "@/components/ui";
import { prisma } from "@/lib/db";
import { INBOX_VIEWS, isChannelKind, type InboxView as View } from "@/lib/inbox/labels";
import { listConversations, teamMembers, viewCounts } from "@/lib/inbox/service";

export const metadata = { title: "Inbox" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await featureGate("inbox");
  if (blocked) return blocked;
  const { business, actorId } = await getAppContext();
  const params = await searchParams;
  const viewParam = one(params.view);
  const view: View = (INBOX_VIEWS as readonly string[]).includes(viewParam ?? "") ? (viewParam as View) : "open";
  const channelParam = one(params.channel);
  const channel = isChannelKind(channelParam) ? channelParam : null;
  const q = (one(params.q) ?? "").slice(0, 100);
  const openId = one(params.c) ?? null;

  const [list, counts, team, used, any] = await Promise.all([
    listConversations(business.id, { view, channel, q }, actorId),
    viewCounts(business.id, actorId),
    teamMembers(business.id),
    prisma.conversation.findMany({ where: { businessId: business.id }, distinct: ["channel"], select: { channel: true } }),
    prisma.conversation.count({ where: { businessId: business.id }, take: 1 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inbox" description="Every conversation from your website chat and connected social accounts. Answer, add notes and share the work with your team." />
      {any === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No conversations yet"
          text="When people write in your website chat, or comment and message your connected Instagram and Facebook accounts, the conversations land here."
          points={["Put the chat on your website (Website chat)", "Switch on “Answer comments and messages” for a social account (Channels)", "Let automations answer the common questions (Automations)"]}
          action={<Button href="/dashboard/automations">Set up an automation</Button>}
        />
      ) : (
        <InboxView
          items={list.items}
          hasMore={list.hasMore}
          counts={counts}
          view={view}
          channel={channel}
          q={q}
          channels={used.map((u) => u.channel)}
          team={team}
          actorId={actorId}
          initialOpenId={openId}
        />
      )}
    </div>
  );
}
