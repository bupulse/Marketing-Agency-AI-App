import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Coins, Megaphone, ShieldCheck } from "lucide-react";
import { BackgroundBlobs } from "@/components/motion";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme";
import { Badge, GlassCard } from "@/components/ui";
import { ApplyForm } from "@/components/creators/portal/apply-form";
import { canPreview, loadPublicCampaign, takesApplications } from "@/lib/creators/apply";
import { formatSpan, NETWORK_ACCOUNT, NETWORK_LABEL, isCreatorNetwork, listWords, creatorPayInWords } from "@/lib/creators/describe";
import { getCurrentUser } from "@/lib/supabase/server";
import { applyAction } from "./actions";

export const dynamic = "force-dynamic";

// A campaign's public application page (docs/CREATOR_CAMPAIGNS.md, "Applying"): the brief, the rules, the platforms,
// the dates and the pay rules in plain words, and the form. Open while the campaign is LIVE and taking applications;
// the company's own people can preview it before that. Shared as a link, never indexed.

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const c = await loadPublicCampaign(slug.toLowerCase()).catch(() => null);
  return {
    title: c ? `${c.name} · ${c.company.name}` : "Creator campaign",
    description: c ? `A creator campaign by ${c.company.name} on BuPulse. Read the brief and apply.` : undefined,
    robots: { index: false, follow: false },
  };
}

function Section({ icon: Icon, title, children }: { icon: typeof Coins; title: string; children: React.ReactNode }) {
  return (
    <GlassCard padding="none" className="flex flex-col gap-3 p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Icon aria-hidden className="size-5 text-pulse-violet" />
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
  const open = takesApplications(campaign);
  const preview = !open && campaign.status === "DRAFT" && (await canPreview(campaign, (await getCurrentUser())?.id));
  if (campaign.status === "DRAFT" && !preview) notFound();

  const pay = creatorPayInWords(campaign.payRules, campaign.goals, campaign.currency);
  const networks = campaign.platforms.filter(isCreatorNetwork);
  const closed = campaign.status === "ENDED" ? "This campaign has ended." : "This campaign is not taking applications right now.";

  return (
    <div className="relative min-h-dvh">
      <BackgroundBlobs />
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-5 sm:px-6">
        <Link href="/" aria-label="BuPulse home" className="inline-flex min-h-11 items-center">
          <Logo height={28} priority />
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-16 pt-6 sm:px-6">
        {preview && (
          <p role="status" className="rounded-field bg-new-bg px-4 py-3 text-sm font-medium text-new">
            Preview: only your company can see this page until the campaign is live.
          </p>
        )}
        <div className="flex items-center gap-3">
          {campaign.company.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL
            <img src={campaign.company.logoUrl} alt="" width={48} height={48} className="size-12 rounded-2xl bg-surface object-contain" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted">Creator campaign by {campaign.company.name}</p>
            <h1 className="text-3xl font-bold leading-tight tracking-[-0.03em] sm:text-4xl">{campaign.name}</h1>
          </div>
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
        </div>

        <Section icon={Megaphone} title="The brief">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{campaign.brief}</p>
        </Section>

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
          {campaign.rules && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{campaign.rules}</p>}
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
            <li>Post from your own {listWords(networks.map((n) => NETWORK_ACCOUNT[n]), "or")}: you connect it to BuPulse so your views can be read. Personal accounts and screenshots are not accepted.</li>
            <li>Post on the task&apos;s day, then hand in the link in BuPulse. BuPulse checks the post&apos;s date, so older posts do not count.</li>
            {campaign.mentions.length > 0 && <li>The caption must include {campaign.mentions.length > 1 ? `one of ${listWords(campaign.mentions, "or")}` : campaign.mentions[0]}.</li>}
            <li>Keep your posts up until the campaign ends: a deleted or hidden post stops earning, and pay it already earned is taken back.</li>
          </ul>
        </Section>

        {open || preview ? (
          <ApplyForm apply={applyAction.bind(null, campaign.slug)} platforms={campaign.platforms} questions={campaign.questions} companyName={campaign.company.name} preview={preview} />
        ) : (
          <GlassCard strong padding="lg" role="status">
            <p className="text-[15px] font-medium">{closed}</p>
          </GlassCard>
        )}
        <p className="text-center text-xs text-muted">
          Run with <Link href="/" className="underline">BuPulse</Link>. Already picked? <Link href="/login?next=/creator" className="underline">Sign in</Link>.
        </p>
      </main>
    </div>
  );
}
