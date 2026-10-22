import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DosDonts } from "@/components/creators/portal/campaign-files";
import { PrintButton } from "@/components/creators/portal/print-button";
import { requireCreator } from "@/lib/creators/auth";
import { campaignKitFor } from "@/lib/creators/campaign-files";
import { formatSpan, formatsInWords, listWords, networkLabel, taskRuleInWords } from "@/lib/creators/describe";
import { ymdOf } from "@/lib/creators/periods";

export const metadata: Metadata = { title: "Brief" };

// The campaign's brief on one page for a creator who joined (docs/CREATOR_CAMPAIGN_WIZARD.md): the brief, what to post,
// the tasks, the do's and don'ts, the rules and the mentions, and where the files are. Made to print, or to save as a
// PDF from the browser's Print (the portal's bar and tabs are left out of the print).

export default async function CampaignBriefPage({ params }: PageProps<"/creator/campaigns/[id]/brief">) {
  const { id } = await params;
  const { profile } = await requireCreator();
  const kit = await campaignKitFor(profile.id, id);
  if (!kit) notFound();
  const { campaign: c, folders } = kit;
  const formats = formatsInWords(c.formats);
  const files = folders.images.length + folders.videos.length + folders.documents.length;

  return (
    <article className="flex flex-col gap-5 print:gap-4 print:text-black">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/creator/campaigns/${c.id}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted no-underline hover:text-text">
          <ArrowLeft aria-hidden className="size-4" /> {c.name}
        </Link>
        <PrintButton />
      </div>
      <header>
        <p className="text-sm font-medium text-muted print:text-black">{c.business.name} · creator campaign brief</p>
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">{c.name}</h1>
        <p className="text-sm text-muted print:text-black">
          {formatSpan(ymdOf(c.startsOn), ymdOf(c.endsOn))} · {listWords(c.platforms.map(networkLabel), c.platformMode === "ALL" ? "and" : "or")}
        </p>
      </header>

      <section className="flex flex-col gap-2 break-inside-avoid">
        <h2 className="text-lg font-semibold">The brief</h2>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{c.brief}</p>
        {formats.length > 0 && (
          <p className="text-[15px]">
            <span className="font-semibold">What to post:</span> {listWords(formats, "or")}
          </p>
        )}
      </section>

      {c.tasks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Tasks</h2>
          {c.tasks.map((t) => (
            <div key={t.id} className="flex flex-col gap-1 break-inside-avoid border-l-2 border-line pl-3">
              <p className="text-[15px] font-semibold">{t.title}</p>
              <p className="text-sm text-muted print:text-black">
                {formatSpan(ymdOf(t.startsOn), ymdOf(t.endsOn))} · {taskRuleInWords(t)}
              </p>
              <p className="whitespace-pre-wrap text-sm">{t.instructions}</p>
            </div>
          ))}
        </section>
      )}

      {(c.dos.length > 0 || c.donts.length > 0) && (
        <section className="flex flex-col gap-2 break-inside-avoid">
          <h2 className="text-lg font-semibold">Do&apos;s and don&apos;ts</h2>
          <DosDonts dos={c.dos} donts={c.donts} />
        </section>
      )}

      {(c.rules || c.mentions.length > 0) && (
        <section className="flex flex-col gap-2 break-inside-avoid">
          <h2 className="text-lg font-semibold">Rules</h2>
          {c.rules && <p className="whitespace-pre-wrap text-sm">{c.rules}</p>}
          {c.mentions.length > 0 && <p className="text-sm">Each caption must include {c.mentions.length > 1 ? `one of ${c.mentions.join(", ")}` : c.mentions[0]}.</p>}
          <p className="text-sm">Post from your connected account, on the task&apos;s day, then hand in the link in BuPulse. Keep your posts up until the campaign ends.</p>
        </section>
      )}

      <section className="flex flex-col gap-1 break-inside-avoid">
        <h2 className="text-lg font-semibold">Files and examples</h2>
        <p className="text-sm">
          {files ? `${files} file${files === 1 ? "" : "s"} from ${c.business.name}: download them on the campaign's page in BuPulse.` : "No files from the company yet."}
        </p>
        {folders.driveUrl && <p className="break-all text-sm">Shared Google Drive folder: {folders.driveUrl}</p>}
        {folders.exampleLinks.map((l) => (
          <p key={l} className="break-all text-sm">
            Example: {l}
          </p>
        ))}
      </section>
    </article>
  );
}
