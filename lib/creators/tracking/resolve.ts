import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { SocialError } from "@/lib/social/types";
import { isCreatorNetwork, NETWORK_LABEL, type CreatorNetwork } from "../describe";
import { ymdOf } from "../periods";
import { BudgetError } from "./caller";
import { failReason, hasMention, onTime, type Checks } from "./checks";
import { expandShortLink, parsePostLink, type ParsedLink } from "./links";
import { nextReadAt, numbersOf } from "./numbers";
import type { Caller, CreatorAdapter, NetworkPost } from "./types";

// Checks a handed-in post link (docs/CREATOR_CAMPAIGNS.md, "Checks"): finds the post on the creator's own connected
// account (check 1), then the network's date against the task's day (check 2) and its caption against the campaign's
// mentions (check 3). Pass: TRACKING, with the first reading. Fail: INVALID with the reason the creator sees. A post
// the network could not be asked about right now (Composio busy, the month's calls used up) stays CHECKING and the
// 6-hourly job tries again; after CHECK_GIVE_UP it becomes INVALID.

export const CHECK_GIVE_UP_MS = 3 * 24 * 60 * 60 * 1000;

export type ResolveDeps = {
  adapter: (network: CreatorNetwork) => CreatorAdapter;
  caller: (connection: { network: string; composioConnectedAccountId: string; profileId: string }) => Caller;
  expand?: (link: ParsedLink) => Promise<ParsedLink | null>;
  now?: Date;
};

export type ResolveOutcome = "tracking" | "invalid" | "waiting" | "budget";

const isUnique = (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");

async function invalid(postId: string, reason: string, checks: Checks, found?: NetworkPost | null) {
  await prisma.creatorPost.update({
    where: { id: postId },
    data: { status: "INVALID", statusReason: reason, checks, ...(found ? { postedAt: found.postedAt, networkCaption: found.caption?.slice(0, 5000) ?? null } : {}) },
  });
  return "invalid" as const;
}

/** Checks one CHECKING post. Never throws for the network's answers; only database errors escape. */
export async function resolvePost(postId: string, deps: ResolveDeps): Promise<ResolveOutcome> {
  const now = deps.now ?? new Date();
  const post = await prisma.creatorPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      status: true,
      network: true,
      url: true,
      createdAt: true,
      campaignId: true,
      submission: { select: { day: true, caption: true } },
      campaign: { select: { mentions: true, business: { select: { timezone: true } } } },
      campaignCreator: { select: { profileId: true } },
    },
  });
  if (!post || post.status !== "CHECKING") return "invalid";
  const network = post.network;
  const blank: Checks = { ownAccount: null, onTime: null, mention: null };
  if (!isCreatorNetwork(network)) return invalid(post.id, "This platform is not part of the campaign.", blank);
  const label = NETWORK_LABEL[network];
  const giveUp = async (reason: string): Promise<ResolveOutcome> => {
    if (now.getTime() - post.createdAt.getTime() > CHECK_GIVE_UP_MS) return invalid(post.id, `We could not check this post for 3 days (${reason}). Hand it in again.`, blank);
    await prisma.creatorPost.update({ where: { id: post.id }, data: { statusReason: reason } });
    return "waiting";
  };

  let link = parsePostLink(network, post.url);
  if (!link) return invalid(post.id, `This is not a link to a post on ${label}. Open the post, tap Share, copy the link and paste it here.`, blank);
  if (link.short) {
    link = await (deps.expand ?? expandShortLink)(link);
    if (!link) return invalid(post.id, `We could not open this share link. Open the post on ${label} in a browser and copy the link from the address bar.`, blank);
  }

  const profileId = post.campaignCreator.profileId;
  const connections = profileId ? await prisma.creatorConnection.findMany({ where: { profileId, network, status: "ACTIVE" }, orderBy: { createdAt: "asc" } }) : [];
  if (!connections.length) return giveUp(`connect your ${label} account in Connections`);

  const day = ymdOf(post.submission.day);
  const tz = post.campaign.business.timezone || "UTC";
  const adapter = deps.adapter(network);
  let found: NetworkPost | null = null;
  let connectionId: string | null = null;
  let temporary: string | null = null;
  for (const c of connections) {
    try {
      found = await adapter.find(deps.caller(c), { network, externalAccountId: c.externalAccountId }, link, day);
    } catch (error) {
      if (error instanceof BudgetError) return "budget";
      if (error instanceof SocialError && error.kind === "auth") {
        await prisma.creatorConnection.update({ where: { id: c.id }, data: { status: "EXPIRED", lastError: error.message.slice(0, 300) } });
        temporary = `reconnect your ${label} account in Connections`;
        continue;
      }
      if (!(error instanceof SocialError)) await logError(error, { source: "creators.resolve", network });
      temporary = `${label} did not answer`;
      continue;
    }
    if (found) {
      connectionId = c.id;
      break;
    }
  }
  if (!found) {
    if (temporary) return giveUp(temporary);
    return invalid(post.id, failReason({ ownAccount: false, onTime: null, mention: null }, [], label)!, { ownAccount: false, onTime: null, mention: null });
  }

  const checks: Checks = {
    ownAccount: true,
    onTime: found.postedAt ? onTime(found.postedAt, day, tz) : false,
    // The network's caption. Meta lists IG Media `caption` under Facebook Login, and Composio's Instagram sign-in is
    // Instagram Login: when the network gives none, the caption the creator handed in is checked instead (to confirm
    // on the owner's first real test, docs/CREATOR_CAMPAIGNS.md).
    mention: hasMention(found.caption ?? post.submission.caption, post.campaign.mentions),
  };
  const reason = failReason(checks, post.campaign.mentions, label);
  if (reason) return invalid(post.id, reason, checks, found);

  // A post earns in one campaign only (CreatorPost @@unique([network, externalId])).
  const other = await prisma.creatorPost.findFirst({ where: { network, externalId: found.externalId, id: { not: post.id } }, select: { campaignId: true } });
  if (other) return invalid(post.id, other.campaignId === post.campaignId ? "You already handed in this post. Each post counts once." : "This post was already handed in for another campaign. A post can earn in one campaign only: make a new post for this task.", checks, found);

  const numbers = numbersOf(found);
  try {
    await prisma.$transaction([
      prisma.creatorPost.update({
        where: { id: post.id },
        data: {
          status: "TRACKING",
          statusReason: null,
          checks,
          externalId: found.externalId,
          connectionId,
          postedAt: found.postedAt,
          networkCaption: found.caption?.slice(0, 5000) ?? null,
          ...numbers,
          lastReadAt: now,
          nextReadAt: nextReadAt(found.postedAt, now),
        },
      }),
      prisma.creatorPostSnapshot.create({ data: { postId: post.id, capturedAt: now, ...numbers } }),
    ]);
  } catch (error) {
    if (isUnique(error)) return invalid(post.id, "This post was already handed in. A post can earn in one campaign only: make a new post for this task.", checks, found);
    throw error;
  }
  return "tracking";
}

/** Checks posts one after the other until `deadline` or the month's calls run out. */
export async function resolvePosts(postIds: string[], deps: ResolveDeps, deadline = Number.POSITIVE_INFINITY): Promise<Record<ResolveOutcome, number>> {
  const out: Record<ResolveOutcome, number> = { tracking: 0, invalid: 0, waiting: 0, budget: 0 };
  for (const id of postIds) {
    if (Date.now() > deadline) break;
    const r = await resolvePost(id, deps);
    out[r]++;
    if (r === "budget") break;
  }
  return out;
}
