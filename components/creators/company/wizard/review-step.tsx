"use client";

// Step 12 of the campaign wizard: everything on one page, a card per step with Edit, what is still missing, and
// "Save as draft" or "Go live". Settings shows the same cards (CampaignSummary), each opening its step.

import { ArrowLeft, CheckCircle2, Pencil, Rocket, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { finishSetupAction, setCampaignStatusAction } from "@/app/dashboard/creators/actions";
import { Button, GlassCard, useToast } from "@/components/ui";
import { formatShortDate } from "@/components/analytics/format";
import { formatAmount, payRulesInWords, PLATFORM_LABEL, TASK_MEDIA_LABEL } from "@/lib/creators/company-forms";
import { daysInclusive } from "@/lib/creators/periods";
import { BRIEF_EVERY, CAMPAIGN_GOALS, CAMPAIGN_KINDS, POST_FORMATS, WIZARD_STEPS, type WizardStepId } from "@/lib/creators/wizard";
import type { WizardAnswers } from "@/lib/creators/wizard-steps";
import type { PickOption } from "./controls";
import type { StepProps } from "./wizard";

type SummaryFacts = { products: PickOption[]; knowledgeCampaigns: PickOption[]; counts: { images: number; videos: number; documents: number }; hasCover: boolean };

const list = (xs: string[], none = "None") => (xs.length ? xs.join(", ") : none);
const n = (v: number, one: string, many: string) => `${v.toLocaleString("en-US")} ${v === 1 ? one : many}`;

/** Each step's answers in a few plain lines. */
export function stepLines(step: WizardStepId, a: WizardAnswers, f: SummaryFacts): string[] {
  switch (step) {
    case "idea":
      return [
        a.name,
        a.idea ? `“${a.idea}”` : "",
        CAMPAIGN_KINDS.find((k) => k.value === a.kind)?.label ?? "",
        a.productIds.length ? `Products: ${list(a.productIds.map((id) => f.products.find((p) => p.id === id)?.label ?? "").filter(Boolean))}` : "",
        a.knowledgeCampaignId ? `Promotes: ${f.knowledgeCampaigns.find((c) => c.id === a.knowledgeCampaignId)?.label ?? "a Business info campaign"}` : "",
      ].filter(Boolean);
    case "goal":
      return [CAMPAIGN_GOALS.find((g) => g.value === a.goal)?.label ?? "Not picked yet"];
    case "creators": {
      const r = a.requirements;
      return [`Topics: ${list(r.niches, "any")}`, `Places: ${list(r.locations, "anywhere")}`, `Languages: ${list(r.languages, "any")}`, r.minFollowers ? `${r.minFollowers.toLocaleString("en-US")}+ followers` : "Any number of followers", r.creatorsWanted ? n(r.creatorsWanted, "creator wanted", "creators wanted") : ""].filter(Boolean);
    }
    case "where":
      return [
        list(a.platforms.map((p) => PLATFORM_LABEL[p]), "No network yet"),
        a.platforms.length > 1 ? (a.platformMode === "ALL" ? "A post on each network" : "One post, on any network") : "",
        a.formats.length ? list(a.formats.map((x) => POST_FORMATS.find((p) => p.value === x)?.label ?? x)) : "",
        a.mentions.length ? `Caption must have: ${a.mentions.join(" or ")}` : "No caption check",
      ].filter(Boolean);
    case "when": {
      const days = daysInclusive(a.startsOn, a.endsOn);
      return [`${formatShortDate(a.startsOn)} to ${formatShortDate(a.endsOn)} (${n(days, "day", "days")})`, BRIEF_EVERY.find((b) => b.value === a.briefEvery)?.label ?? "", `${a.postsPerDay} a day · ${TASK_MEDIA_LABEL[a.mediaKind]}`].filter(Boolean);
    }
    case "content":
      return [a.brief ? (a.brief.length > 140 ? `${a.brief.slice(0, 140)}…` : a.brief) : "No brief yet", n(a.tasks.length, "task", "tasks")];
    case "rules":
      return [n(a.dos.length, "do", "do's"), n(a.donts.length, "don't", "don'ts"), a.rules ? "And your own rules" : ""].filter(Boolean);
    case "pay": {
      const words = payRulesInWords(a.payRules, a.currency);
      return [...(words.length ? words : ["No pay set yet"]), a.budget ? `Budget: ${formatAmount(a.budget, a.currency)} a period` : "No budget limit"];
    }
    case "form": {
      const extra = a.applicationForm.fields.length;
      return [`Name, email and social accounts${a.applicationForm.phone !== "HIDDEN" ? ", phone" : ""}${a.applicationForm.samples !== "HIDDEN" ? ", best posts" : ""}`, extra ? n(extra, "question of yours", "questions of yours") : "No questions of yours"];
    }
    case "files":
      return [`${n(f.counts.images, "image", "images")}, ${n(f.counts.videos, "video", "videos")}, ${n(f.counts.documents, "document", "documents")}`, a.files.driveUrl ? "Google Drive folder shared" : "", a.files.exampleLinks.length ? n(a.files.exampleLinks.length, "example link", "example links") : ""].filter(Boolean);
    case "look":
      return [f.hasCover ? "Cover picked" : "No cover", a.listed ? "Shown on the marketplace" : "Not on the marketplace", a.acceptingApplications ? "Taking applications" : "Not taking applications"];
    case "review":
      return [];
  }
}

/** A card per step with its answers and Edit (to /setup?step=N). */
export function CampaignSummary({ campaignId, a, facts }: { campaignId: string; a: WizardAnswers; facts: SummaryFacts }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {WIZARD_STEPS.filter((s) => s.id !== "review").map((s, i) => (
        <li key={s.id}>
          <GlassCard className="flex h-full flex-col gap-2 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[16px] font-semibold">
                <span className="text-muted">{i + 1}.</span> {s.title}
              </h2>
              <Link href={`/dashboard/creators/${campaignId}/setup?step=${i + 1}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold no-underline hover:bg-soft" aria-label={`Edit ${s.title}`}>
                <Pencil aria-hidden className="size-4" /> Edit
              </Link>
            </div>
            <ul className="flex flex-col gap-0.5 text-[14px] text-muted">
              {stepLines(s.id, a, facts).map((l, j) => (
                <li key={j} className={j === 0 ? "font-medium text-text" : undefined}>
                  {l}
                </li>
              ))}
            </ul>
          </GlassCard>
        </li>
      ))}
    </ul>
  );
}

export function ReviewStep({ a, o }: StepProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const id = o.campaignId!;
  const draft = o.status === "DRAFT";
  const ready = o.problems.length === 0;

  async function saveDraft() {
    setBusy(true);
    const r = await finishSetupAction(id);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Saved as a draft. It goes live when you say so.", "success");
    router.push(`/dashboard/creators/${id}`);
  }
  async function goLive() {
    setBusy(true);
    const r = await setCampaignStatusAction(id, "LIVE");
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Live. Share your link: creators can apply now.", "success");
    router.push(`/dashboard/creators/${id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <CampaignSummary campaignId={id} a={a} facts={{ products: o.products, knowledgeCampaigns: o.knowledgeCampaigns, counts: o.counts, hasCover: Boolean(a.look.coverAssetId) }} />

      {draft &&
        (ready ? (
          <p role="status" className="flex items-center gap-2 rounded-2xl bg-success-bg px-4 py-3 text-[15px] font-medium text-success">
            <CheckCircle2 aria-hidden className="size-5 shrink-0" /> Everything is ready. Go live when you want creators to apply.
          </p>
        ) : (
          <div role="status" className="flex flex-col gap-2 rounded-2xl bg-danger-bg px-4 py-3 text-[15px] text-danger">
            <p className="flex items-center gap-2 font-semibold">
              <TriangleAlert aria-hidden className="size-5 shrink-0" /> Before it can go live:
            </p>
            <ul className="list-disc pl-6">
              {o.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ))}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <Button variant="outline" href={`/dashboard/creators/${id}/setup?step=11`} leading={<ArrowLeft aria-hidden className="size-4" />}>
          Back
        </Button>
        {draft ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={saveDraft}>
              Save as draft
            </Button>
            <Button disabled={busy || !ready} title={ready ? undefined : o.problems[0]} leading={<Rocket aria-hidden className="size-4" />} onClick={goLive}>
              Go live
            </Button>
          </div>
        ) : (
          <Button href={`/dashboard/creators/${id}/settings`}>Done</Button>
        )}
      </div>
    </div>
  );
}
