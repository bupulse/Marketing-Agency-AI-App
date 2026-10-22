import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Check, Coins, Megaphone, ShieldCheck, Target, Users, X } from "lucide-react";
import { Badge, Button, GlassCard } from "@/components/ui";
import { BrandedFrame } from "@/components/creators/apply/branded-frame";
import { placesInWords } from "@/components/creators/marketplace/campaign-card";
import { PaymentRecordLine } from "@/components/creators/marketplace/payment-record";
import { ApplyForm } from "@/components/creators/portal/apply-form";
import { QuickApplyForm } from "@/components/creators/portal/quick-apply-form";
import { ReportCampaign } from "@/components/creators/portal/report-campaign";
import { reportCampaignAction } from "@/app/creator/(portal)/actions";
import { splitName } from "@/lib/creators/application";
import { canPreview, loadPublicCampaign, takesApplications, type PublicCampaign } from "@/lib/creators/apply";
import { publicViewer } from "@/lib/creators/auth";
import { brandLook } from "@/lib/creators/brand-look";
import { campaignCover } from "@/lib/creators/campaign-files";
import { formatSpan, formatsInWords, NETWORK_ACCOUNT, NETWORK_LABEL, isCreatorNetwork, listWords, creatorPayInWords, requirementsInWords } from "@/lib/creators/describe";
import { placesLeftIn } from "@/lib/creators/marketplace";
import { SOCIAL_LABEL, isSocialNetwork } from "@/lib/creators/networks";
import { dayIn } from "@/lib/creators/periods";
import { loadProfile } from "@/lib/creators/profile";
import { gapsInWords } from "@/lib/creators/profile-form";
import { viewerOf } from "@/lib/creators/quick-apply";
import { quickApplyAsks } from "@/lib/creators/quick-apply-form";
import { paymentRecord } from "@/lib/creators/record";
import { CAMPAIGN_REPORT_REASONS, REPORT_REASON_LABEL } from "@/lib/creators/reports";
import { applyAction, quickApplyAction, startApplicationUploadAction } from "./actions";

export const dynamic = "force-dynamic";

// A campaign's public application page (docs/CREATOR_CAMPAIGNS.md, "Applying"; docs/CREATOR_MARKETPLACE.md;
// docs/CREATOR_CAMPAIGN_WIZARD.md): in the company's look (logo, colours, cover), the brief, who they look for, the
// formats, the rules with the do's and don'ts, the platforms, the dates, the pay rules in plain words, the places left
// and the company's payment record. Visitors get the company's form; a signed-in creator applies with their profile,
// answering only what it cannot (and can report the campaign); a company person is told creators apply with a creator
// account. Open while the campaign is LIVE and
// taking applications; the company's own people can preview it before that. Indexed only while it is on the
// marketplace (listed, not hidden); unlisted and hidden campaigns keep their link, noindex.

/** On the marketplace now, so search engines may list its page (lib/creators/market-filters.ts isListed). */
const onMarket = (c: PublicCampaign) => takesApplications(c) && c.listed && !c.hidden && c.endsOn >= dayIn(new Date(), c.company.timezone);

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const c = await loadPublicCampaign(slug.toLowerCase()).catch(() => null);
  const shown = c && c.status !== "DRAFT" ? c : null;
  const description = shown ? `A creator campaign by ${shown.company.name} on BuPulse. ${creatorPayInWords(shown.payRules, shown.goals, shown.currency)[0] ?? "Read the brief"}. Apply as a creator.` : undefined;
  return {
    title: shown ? `${shown.name} · ${shown.company.name}` : "Creator campaign",
    description,
    alternates: shown ? { canonical: `/c/${shown.slug}` } : undefined,
    openGraph: shown ? { title: `${shown.name} · ${shown.company.name}`, description, url: `/c/${shown.slug}`, type: "website" } : undefined,
    robots: shown && onMarket(shown) ? { index: true, follow: true } : { index: false, follow: false },
  };
}

function Section({ icon: Icon, title, children }: { icon: typeof Coins; title: string; children: React.ReactNode }) {
  return (
    <GlassCard padding="none" className="flex flex-col gap-3 p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Icon aria-hidden className="size-5 text-[color:var(--brand)]" />
        {title}
      </h2>
      {children}
    </GlassCard>
  );
}

export default async function CampaignPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const campaign = await loadPublicCampaign(slug.toLowerCase());
  if (!campaign) notFound();
  const { kind, user } = await publicViewer();
  // Hidden by a BuPulse admin: the page stays for the creators already in it, but takes no new applications.
  const open = takesApplications(campaign) && !campaign.hidden;
  const preview = !open && campaign.status === "DRAFT" && (await canPreview(campaign, user?.id));
  if (campaign.status === "DRAFT" && !preview) notFound();
  const [viewer, places, record, cover] = await Promise.all([viewerOf(campaign, user), placesLeftIn({ id: campaign.id, businessId: campaign.company.id }), paymentRecord(campaign.company.id), campaignCover(campaign.company.id, campaign.coverAssetId).catch(() => null)]);
  const profile = viewer.kind === "creator" && !viewer.applied && !viewer.blocked && !viewer.gaps.length ? await loadProfile(viewer.profileId) : null;

  const pay = creatorPayInWords(campaign.payRules, campaign.goals, campaign.currency);
  const networks = campaign.platforms.filter(isCreatorNetwork);
  const closed = campaign.status === "ENDED" ? "This campaign has ended." : places === 0 && open ? "All places in this campaign are taken right now." : "This campaign is not taking applications right now.";
  const canApply = open && places > 0;
  const back = `/c/${campaign.slug}`;
  const look = brandLook(campaign.company.brandColors);
  const startUpload = startApplicationUploadAction.bind(null, campaign.slug);
  const wanted = requirementsInWords(campaign.requirements);
  const formats = formatsInWords(campaign.formats);

  return (
    <BrandedFrame look={look} company={campaign.company} cover={cover} viewer={kind} back={back}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-6">
        {preview && (
          <p role="status" className="rounded-field bg-new-bg px-4 py-3 text-sm font-medium text-new">
            Preview: only your company can see this page until the campaign is live.
          </p>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">Creator campaign by {campaign.company.name}</p>
          <h1 className="text-3xl font-bold leading-tight tracking-[-0.03em] sm:text-4xl">{campaign.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">
            <CalendarDays aria-hidden className="size-3.5" />
            {formatSpan(campaign.startsOn, campaign.endsOn)}
          </Badge>
          {networks.map((n) => (
            <Badge key={n} tone="violet">
              {NETWORK_LABEL[n]}
            </Badge>
          ))}
          {open && (
            <Badge tone={places === 0 ? "danger" : "success"}>
              <Users aria-hidden className="size-3.5" />
              {placesInWords(places)}
            </Badge>
          )}
        </div>
        <PaymentRecordLine record={record} className="text-sm" />

        <Section icon={Megaphone} title="The brief">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{campaign.brief}</p>
          {formats.length > 0 && <p className="text-[14px]"><span className="font-semibold">What to post:</span> {listWords(formats, "or")}</p>}
        </Section>

        {wanted.length > 0 && (
          <Section icon={Target} title="Who they look for">
            <p className="text-[15px]">{wanted.join(" · ")}</p>
            <p className="text-[13px] text-muted">You can apply even if you don&apos;t fit everything: {campaign.company.name} sees who fits best first.</p>
          </Section>
        )}

        <Section icon={Coins} title="How you are paid">
          {pay.length ? (
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
              {pay.map((line) => (
                <li key={line}>{line}.</li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-muted">The company has not set the pay yet.</p>
          )}
          <p className="text-[13px] text-muted">
            Views are counted by BuPulse from your connected account, each month (30 days) on its own. {campaign.company.name} pays you by Mobile Money at the end of each month.
          </p>
        </Section>

        <Section icon={ShieldCheck} title="The rules">
          {(campaign.dos.length > 0 || campaign.donts.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {campaign.dos.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-[15px]" aria-label="Do">
                  {campaign.dos.map((d) => (
                    <li key={d} className="flex gap-2">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              {campaign.donts.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-[15px]" aria-label="Don't">
                  {campaign.donts.map((d) => (
                    <li key={d} className="flex gap-2">
                      <X aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                      {d}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {campaign.rules && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{campaign.rules}</p>}
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
            <li>Post from your own {listWords(networks.map((n) => NETWORK_ACCOUNT[n]), "or")}: you connect it to BuPulse so your views can be read. Personal accounts and screenshots are not accepted.</li>
            <li>Post on the task&apos;s day, then hand in the link in BuPulse. BuPulse checks the post&apos;s date, so older posts do not count.</li>
            {campaign.mentions.length > 0 && <li>The caption must include {campaign.mentions.length > 1 ? `one of ${listWords(campaign.mentions, "or")}` : campaign.mentions[0]}.</li>}
            <li>Keep your posts up until the campaign ends: a deleted or hidden post stops earning, and pay it already earned is taken back.</li>
          </ul>
        </Section>

        {preview ? (
          <ApplyForm apply={applyAction.bind(null, campaign.slug)} startUpload={startUpload} form={campaign.form} platforms={campaign.platforms} currency={campaign.currency} companyName={campaign.company.name} preview />
        ) : viewer.kind === "creator" && viewer.applied ? (
          <GlassCard strong padding="lg" role="status" className="flex flex-col items-start gap-3">
            <p className="text-[15px] font-medium">{viewer.applied.status === "OFFERED" ? `${campaign.company.name} invited you to this campaign. Answer on your Campaigns page.` : viewer.applied.status === "JOINED" ? "You are in this campaign." : "You applied to this campaign."}</p>
            <Button href="/creator" size="sm">Your campaigns</Button>
          </GlassCard>
        ) : !canApply ? (
          <GlassCard strong padding="lg" role="status">
            <p className="text-[15px] font-medium">{closed}</p>
          </GlassCard>
        ) : viewer.kind === "company" ? (
          <GlassCard strong padding="lg" role="status" className="flex flex-col items-start gap-2">
            <p className="text-[15px] font-medium">Creators apply with a creator account.</p>
            <p className="text-sm text-muted">You are signed in as a company. To apply, sign out and make a creator account with another email.</p>
          </GlassCard>
        ) : viewer.kind === "creator" ? (
          viewer.blocked ? (
            <GlassCard strong padding="lg" role="status">
              <p className="text-[15px] font-medium">Your creator account cannot apply to campaigns right now. Write to BuPulse if you think this is a mistake.</p>
            </GlassCard>
          ) : viewer.gaps.length ? (
            <GlassCard strong padding="lg" className="flex flex-col items-start gap-3">
              <h2 className="text-xl font-semibold tracking-tight">Apply in one tap</h2>
              <p className="text-[15px] text-muted">{gapsInWords(viewer.gaps, campaign.platforms)} to your profile first, then come back here.</p>
              <Button href={`/creator/profile?next=${encodeURIComponent(back)}`}>Complete my profile</Button>
            </GlassCard>
          ) : profile ? (
            <QuickApplyForm
              apply={quickApplyAction.bind(null, campaign.slug)}
              startUpload={startUpload}
              form={campaign.form}
              asks={quickApplyAsks(campaign.form, { name: profile.name, phone: profile.phone, location: profile.location, samples: profile.samples })}
              prefill={{ ...splitName(profile.name), phone: profile.phone, samples: profile.samples.length, accounts: profile.handles.map((h) => `${isSocialNetwork(h.network) ? SOCIAL_LABEL[h.network] : h.network} @${h.handle.replace(/^@/, "")}`) }}
              currency={campaign.currency}
              companyName={campaign.company.name}
              slug={campaign.slug}
            />
          ) : null
        ) : (
          <>
            <GlassCard padding="none" className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[15px] font-medium">Have a creator account? Apply in one tap with your profile.</p>
              <div className="flex shrink-0 gap-2">
                <Button href={`/login?next=${encodeURIComponent(back)}`} size="sm" variant="outline">Sign in</Button>
                <Button href="/creators/signup" size="sm">Make one</Button>
              </div>
            </GlassCard>
            <ApplyForm apply={applyAction.bind(null, campaign.slug)} startUpload={startUpload} form={campaign.form} platforms={campaign.platforms} currency={campaign.currency} companyName={campaign.company.name} />
          </>
        )}

        {viewer.kind === "creator" && <ReportCampaign report={reportCampaignAction.bind(null, campaign.id)} reasons={CAMPAIGN_REPORT_REASONS.map((r) => ({ value: r, label: REPORT_REASON_LABEL[r] }))} />}
        <p className="text-center text-xs text-muted">
          <Link href="/creators" className="underline">More campaigns</Link>
          {kind === "guest" && (
            <>
              {" "}· Already picked? <Link href="/login?next=/creator" className="underline">Sign in</Link>
            </>
          )}
        </p>
      </main>
    </BrandedFrame>
  );
}
