import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { InboxScreen } from "@/components/inbox/inbox-screen";
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
    <InboxScreen
      view={
        any === 0
          ? null
          : { items: list.items, hasMore: list.hasMore, counts, view, channel, q, channels: used.map((u) => u.channel), team, actorId, initialOpenId: openId }
      }
    />
  );
}
