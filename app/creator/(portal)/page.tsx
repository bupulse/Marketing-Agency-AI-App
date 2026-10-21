import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, ChevronRight, ListChecks, Search, UserRound } from "lucide-react";
import { Badge, Button, GlassCard, type BadgeTone } from "@/components/ui";
import { CompanyLogo } from "@/components/creators/marketplace/campaign-card";
import { OfferAnswer } from "@/components/creators/portal/offer-answer";
import { PostStatus } from "@/components/creators/portal/post-status";
import { requireCreator } from "@/lib/creators/auth";
import { creatorPayInWords, formatDay, formatSpan, isCreatorNetwork, listWords, NETWORK_LABEL, networkLabel, CREATOR_NETWORKS } from "@/lib/creators/describe";
import { logoUrls } from "@/lib/creators/logos";
import { readPayRules } from "@/lib/creators/pay";
import { ymdOf } from "@/lib/creators/periods";
import { myCampaignRows, recentlyStopped, todaysTasks } from "@/lib/creators/portal";
import { groupCampaigns, offerEndsAt, offerExpired, rowLabel, type CampaignGroup } from "@/lib/creators/portal-groups";
import { profileGaps } from "@/lib/creators/profile-form";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Your campaigns" };

// The portal's home (docs/CREATOR_MARKETPLACE.md, "The creator's dashboard"): every campaign the creator is in, by
// status: Invitations (Accept or Decline), Joined, Waiting for the company, Ended. Plus what is due today (Tasks) and
// a way to find more campaigns.

type Row = Awaited<ReturnType<typeof myCampaignRows>>[number];

const GROUPS: { key: CampaignGroup; title: string; empty?: string }[] = [
  { key: "invitations", title: "Invitations" },
  { key: "joined", title: "Joined", empty: "You have not joined a campaign yet." },
  { key: "waiting", title: "Waiting for the company" },
  { key: "ended", title: "Ended" },
];

const TONE: Record<string, BadgeTone> = { Live: "success", Invitation: "violet", Picked: "blue", Applied: "blue", Expired: "neutral", Left: "danger" };

export default async function CreatorHome() {
  const { profile, email } = await requireCreator();
  const [rows, today, stopped, connections, me] = await Promise.all([
    myCampaignRows(profile.id, email),
    todaysTasks(profile.id),
    recentlyStopped(profile.id),
    prisma.creatorConnection.findMany({ where: { profileId: profile.id, status: "ACTIVE" }, select: { network: true } }),
    prisma.creatorProfile.findUnique({ where: { id: profile.id }, select: { phone: true, handles: true } }),
  ]);
  const now = new Date();
  const groups = groupCampaigns(rows, now);
  const logos = await logoUrls(rows.map((r) => r.campaign.business.logoUrl));
  const connected = new Set(connections.map((c) => c.network));
  const needed = [...new Set(groups.joined.filter((r) => r.campaign.status === "LIVE").flatMap((r) => r.campaign.platforms))].filter((n) => isCreatorNetwork(n) && !connected.has(n));
  const left = today.filter((t) => t.left > 0).length;
  const incomplete = me ? profileGaps(me, [...CREATOR_NETWORKS]).length > 0 : false;
  const first = profile.name.split(/\s+/)[0];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Hi {first}</h1>
        <Button href="/creators" size="sm" variant="outline" leading={<Search aria-hidden className="size-4" />}>
          Find campaigns
        </Button>
      </div>

      {incomplete && (
        <GlassCard padding="none" role="status" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-[15px] font-medium">
            <UserRound aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-violet" />
            Complete your profile (your WhatsApp and at least one account) to apply to campaigns in one tap.
          </p>
          <Button href="/creator/profile" size="sm" className="shrink-0">Profile</Button>
        </GlassCard>
      )}

      {needed.length > 0 && (
        <GlassCard padding="none" role="status" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-[15px] font-medium">
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-violet" />
            Connect your {listWords(needed.map(networkLabel))}: BuPulse reads your views from your connected accounts, and only their posts count.
          </p>
          <Button href="/creator/connections" size="sm" className="shrink-0">Connect</Button>
        </GlassCard>
      )}

      {today.length > 0 && (
        <Link href="/creator/tasks" className="glass flex items-center gap-3 rounded-glass p-4 no-underline hover:bg-soft">
          <ListChecks aria-hidden className="size-6 shrink-0 text-pulse-violet" />
          <span className="flex-1 text-[15px] font-semibold">{left === 0 ? "Done for today" : `${left} task${left === 1 ? "" : "s"} to hand in today`}</span>
          <ChevronRight aria-hidden className="size-5 text-muted" />
        </Link>
      )}

      {stopped.length > 0 && (
        <GlassCard padding="none" className="flex flex-col gap-2 p-4">
          <h2 className="text-[15px] font-semibold">Stopped earning lately</h2>
          <ul className="flex flex-col gap-2">
            {stopped.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <PostStatus status={p.status} />
                  <Link href={`/creator/campaigns/${p.campaign.id}`} className="font-medium underline">{p.campaign.name}</Link>
                  <span className="text-muted">{networkLabel(p.network)}</span>
                </span>
                {p.statusReason && <span className="text-muted">{p.statusReason}</span>}
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      {rows.length === 0 ? (
        <GlassCard padding="md" className="flex flex-col items-start gap-3">
          <p className="text-[15px] text-muted">No campaigns yet. Find one on the marketplace and apply in one tap, or wait for a company to invite you.</p>
          <Button href="/creators" size="sm">Find campaigns</Button>
        </GlassCard>
      ) : (
        GROUPS.filter((g) => groups[g.key].length > 0 || g.empty).map((g) => (
          <section key={g.key} aria-labelledby={`g-${g.key}`} className="flex flex-col gap-3">
            <h2 id={`g-${g.key}`} className="text-lg font-semibold tracking-tight">
              {g.title}
              {groups[g.key].length > 0 && <span className="ml-2 text-sm font-medium text-muted">{groups[g.key].length}</span>}
            </h2>
            {groups[g.key].length === 0 ? (
              <p className="text-[15px] text-muted">{g.empty}</p>
            ) : (
              groups[g.key].map((r) => <CampaignRow key={r.id} row={r} logo={r.campaign.business.logoUrl ? (logos.get(r.campaign.business.logoUrl) ?? null) : null} now={now} />)
            )}
          </section>
        ))
      )}
    </>
  );
}

function CampaignRow({ row, logo, now }: { row: Row; logo: string | null; now: Date }) {
  const c = row.campaign;
  const label = rowLabel(row, now);
  // Joined (or left) campaigns open in the portal; the others on their public page.
  const href = row.status === "JOINED" || row.status === "REMOVED" ? `/creator/campaigns/${c.id}` : `/c/${c.slug}`;
  const head = (
    <div className="flex items-center gap-3">
      <CompanyLogo name={c.business.name} url={logo} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">{c.business.name}</p>
        <p className="truncate text-[15px] font-semibold">{c.name}</p>
        <p className="text-sm text-muted">
          {formatSpan(ymdOf(c.startsOn), ymdOf(c.endsOn))} · {listWords(c.platforms.filter(isCreatorNetwork).map((n) => NETWORK_LABEL[n]))}
        </p>
      </div>
      <Badge tone={TONE[label] ?? "neutral"} className="shrink-0">{label}</Badge>
    </div>
  );

  if (row.status === "OFFERED" && c.status !== "ENDED") {
    const expired = offerExpired(row.offeredAt, now);
    const pay = creatorPayInWords(readPayRules(c.payRules), { viewTargetPerCreator: c.viewTargetPerCreator, viewTargetCampaign: c.viewTargetCampaign }, c.currency);
    return (
      <GlassCard padding="none" className="flex flex-col gap-3 p-4">
        {head}
        {pay[0] && <p className="text-sm font-medium">{pay[0]}</p>}
        <Link href={`/c/${c.slug}`} className="self-start text-sm font-medium text-pulse-blue underline">Read the brief and the rules</Link>
        {expired ? (
          <p className="text-sm text-muted">This invitation has expired. The company can invite you again.</p>
        ) : (
          <>
            {row.offeredAt && <p className="text-[13px] text-muted">{c.business.name} invited you. Answer by {formatDay(offerEndsAt(row.offeredAt).toISOString().slice(0, 10))}.</p>}
            <OfferAnswer id={row.id} campaignId={c.id} />
          </>
        )}
      </GlassCard>
    );
  }

  return (
    <Link href={href} className="glass flex flex-col gap-2 rounded-glass p-4 no-underline hover:bg-soft">
      {head}
      {row.status === "SELECTED" && c.status !== "ENDED" && <p className="text-sm text-muted">The company picked you: open the link in the email they sent to join.</p>}
      {row.status === "APPLIED" && c.status !== "ENDED" && <p className="text-sm text-muted">The company reads every application. If they pick you, you get an email.</p>}
    </Link>
  );
}
