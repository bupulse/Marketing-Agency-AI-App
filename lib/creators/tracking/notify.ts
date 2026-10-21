import "server-only";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { alertRecipients } from "@/lib/team/recipients";
import { amount, networkLabel } from "../describe";

// What the job tells people (docs/CREATOR_CAMPAIGNS.md): a post that stopped earning (the creator and the company), a
// connection that needs signing in again (the creator), and a closed period's payouts (the creator and the company).
// Email, best effort: a mail problem never stops the job. In the app, the creator's portal shows each post's status and
// reason, and its home page lists the posts that stopped earning lately; the company sees them on its dashboard.

type Removed = { postId: string; reason: string };

/** One email per creator and one per company for the posts removed in this run. */
export async function notifyRemoved(removed: Removed[]): Promise<number> {
  if (!removed.length) return 0;
  const posts = await prisma.creatorPost.findMany({
    where: { id: { in: removed.map((r) => r.postId) } },
    select: {
      id: true,
      network: true,
      url: true,
      campaign: { select: { id: true, name: true, businessId: true, business: { select: { name: true, user: { select: { email: true } } } } } },
      campaignCreator: { select: { name: true, profile: { select: { user: { select: { email: true } } } } } },
    },
  });
  const reasonOf = new Map(removed.map((r) => [r.postId, r.reason]));
  const site = publicSiteUrl();
  let sent = 0;

  const byCreator = new Map<string, typeof posts>();
  for (const p of posts) {
    const email = p.campaignCreator.profile?.user.email;
    if (!email) continue;
    byCreator.set(email, [...(byCreator.get(email) ?? []), p]);
  }
  for (const [to, list] of byCreator) {
    const mail = renderEmail({
      heading: list.length === 1 ? "A post stopped earning" : `${list.length} posts stopped earning`,
      intro: "BuPulse could no longer find these posts on your account, so they stop earning. Pay they earned in a period that was already paid is taken off your next payout.",
      blocks: list.map((p) => ({ label: `${p.campaign.name} · ${networkLabel(p.network)}`, value: `${p.url}\n${reasonOf.get(p.id) ?? ""}` })),
      button: { label: "Open my campaigns", url: `${site}/creator` },
    });
    if (await sendEmail({ to, subject: list.length === 1 ? "A post stopped earning" : `${list.length} posts stopped earning`, ...mail })) sent++;
  }

  const byCampaign = new Map<string, typeof posts>();
  for (const p of posts) byCampaign.set(p.campaign.id, [...(byCampaign.get(p.campaign.id) ?? []), p]);
  for (const list of byCampaign.values()) {
    const c = list[0].campaign;
    const mail = renderEmail({
      heading: `${list.length === 1 ? "A creator post was" : `${list.length} creator posts were`} removed`,
      intro: `In ${c.name}, these posts are gone from the creators' accounts, so they stop earning. BuPulse took their pay out of payouts not paid yet.`,
      blocks: list.map((p) => ({ label: `${p.campaignCreator.name} · ${networkLabel(p.network)}`, value: p.url })),
      button: { label: "Open the campaign", url: `${site}/dashboard/creators` },
    });
    const recipients = await alertRecipients(c.businessId, c.business.user.email);
    for (const to of recipients) if (await sendEmail({ to, subject: `Creator posts removed: ${c.name}`, ...mail })) sent++;
  }
  return sent;
}

/** The creator's account needs signing in again: their posts stop earning after 3 days without it. */
export async function notifyReconnect(connectionId: string): Promise<boolean> {
  const c = await prisma.creatorConnection.findUnique({ where: { id: connectionId }, select: { network: true, username: true, profile: { select: { user: { select: { email: true } } } } } });
  const to = c?.profile.user.email;
  if (!c || !to) return false;
  const label = networkLabel(c.network);
  const mail = renderEmail({
    heading: `Connect your ${label} again`,
    intro: `BuPulse can no longer read your ${label}${c.username ? ` (${c.username})` : ""}. Connect it again within 3 days, or your posts on it stop earning.`,
    button: { label: "Open Connections", url: `${publicSiteUrl()}/creator/connections` },
  });
  return sendEmail({ to, subject: `Connect your ${label} again`, ...mail });
}

/** A closed period: each creator hears what they earned; the company that payouts are ready. */
export async function notifyPayouts(periodId: string): Promise<number> {
  const period = await prisma.creatorPeriod.findUnique({
    where: { id: periodId },
    select: {
      index: true,
      campaign: { select: { name: true, currency: true, businessId: true, business: { select: { name: true, user: { select: { email: true } } } } } },
      payouts: { select: { amount: true, campaignCreator: { select: { profile: { select: { user: { select: { email: true } } } } } } } },
    },
  });
  if (!period || !period.payouts.length) return 0;
  const c = period.campaign;
  const site = publicSiteUrl();
  let sent = 0;
  for (const p of period.payouts) {
    const to = p.campaignCreator.profile?.user.email;
    if (!to || p.amount <= 0) continue;
    const mail = renderEmail({
      heading: `You earned ${amount(p.amount, c.currency)}`,
      intro: `Month ${period.index} of ${c.name} is over. ${c.business.name} pays you by Mobile Money and marks it paid in BuPulse.`,
      button: { label: "See the details", url: `${site}/creator/earnings` },
    });
    if (await sendEmail({ to, subject: `${c.name}: you earned ${amount(p.amount, c.currency)}`, ...mail })) sent++;
  }
  const total = period.payouts.reduce((s, p) => s + p.amount, 0);
  const mail = renderEmail({
    heading: "Creator payouts are ready",
    intro: `Month ${period.index} of ${c.name} is over: ${period.payouts.length} creator${period.payouts.length === 1 ? "" : "s"}, ${amount(total, c.currency)} in all. Pay each one by Mobile Money, then mark it paid with the reference.`,
    button: { label: "Open payouts", url: `${site}/dashboard/creators` },
  });
  for (const to of await alertRecipients(c.businessId, c.business.user.email)) if (await sendEmail({ to, subject: `Creator payouts ready: ${c.name}`, ...mail })) sent++;
  return sent;
}
