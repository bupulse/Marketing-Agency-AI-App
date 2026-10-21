"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createCampaignAction, updateCampaignAction } from "@/app/dashboard/creators/actions";
import { Button, Field, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { campaignSchema, firstProblem, mentionsFrom, payRulesInWords, PLATFORM_LABEL, PLATFORMS, type CampaignInput, type CampaignQuestion, type Platform } from "@/lib/creators/company-forms";
import type { PayRules } from "@/lib/creators/pay";

export type CampaignFormInitial = {
  name: string;
  brief: string;
  rules: string | null;
  platforms: string[];
  startsOn: string;
  endsOn: string;
  mentions: string[];
  currency: string;
  payRules: PayRules;
  viewTargetPerCreator: number | null;
  viewTargetCampaign: number | null;
  budget: number | null;
  questions: CampaignQuestion[];
};

const CURRENCIES = ["RWF", "USD", "KES", "UGX", "TZS", "BIF"];

/** "12,000" or "" → a whole number or null. */
const num = (s: string) => {
  const t = s.replace(/[,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.floor(n) : NaN;
};
const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** The campaign form: new campaign, or its settings (dates and currency only while it is a draft). */
export function CampaignForm({ mode, campaignId, initial, draft = true }: { mode: "create" | "edit"; campaignId?: string; initial: CampaignFormInitial; /** Dates and currency can change only while the campaign is a draft. */ draft?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial.name);
  const [brief, setBrief] = useState(initial.brief);
  const [rules, setRules] = useState(initial.rules ?? "");
  const [platforms, setPlatforms] = useState<Platform[]>(initial.platforms.filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p)));
  const [startsOn, setStartsOn] = useState(initial.startsOn);
  const [endsOn, setEndsOn] = useState(initial.endsOn);
  const [mentions, setMentions] = useState(initial.mentions.join(" "));
  const [currency, setCurrency] = useState(initial.currency);
  const [rate, setRate] = useState(str(initial.payRules.ratePerThousand));
  const [fee, setFee] = useState(str(initial.payRules.feePerPost));
  const [capPost, setCapPost] = useState(str(initial.payRules.capPerPost));
  const [capCreator, setCapCreator] = useState(str(initial.payRules.capPerCreator));
  const [milestones, setMilestones] = useState((initial.payRules.milestones ?? []).map((m) => ({ views: String(m.views), amount: String(m.amount) })));
  const [targetCreator, setTargetCreator] = useState(str(initial.viewTargetPerCreator));
  const [targetCampaign, setTargetCampaign] = useState(str(initial.viewTargetCampaign));
  const [budget, setBudget] = useState(str(initial.budget));
  const [questions, setQuestions] = useState(initial.questions);

  const payRules: PayRules = {
    ratePerThousand: num(rate),
    feePerPost: num(fee),
    capPerPost: num(capPost),
    capPerCreator: num(capCreator),
    milestones: milestones.filter((m) => m.views.trim() || m.amount.trim()).map((m) => ({ views: num(m.views) ?? NaN, amount: num(m.amount) ?? NaN })),
  };
  const input: CampaignInput = {
    name,
    brief,
    rules: rules.trim() || null,
    platforms,
    startsOn,
    endsOn,
    mentions: mentionsFrom(mentions),
    currency,
    payRules,
    viewTargetPerCreator: num(targetCreator),
    viewTargetCampaign: num(targetCampaign),
    budget: num(budget),
    questions: questions.filter((q) => q.label.trim()),
  };
  const words = payRulesInWords({ ...payRules, milestones: payRules.milestones?.filter((m) => m.views > 0 && m.amount > 0) }, currency);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const numbers: [string, string][] = [["Per 1,000 views", rate], ["Per post handed in", fee], ["Most one post earns", capPost], ["Most one creator earns", capCreator], ["Views per creator", targetCreator], ["Views of all creators", targetCampaign], ["Budget", budget]];
    const bad = numbers.find(([, v]) => Number.isNaN(num(v)));
    if (bad) return setError(`${bad[0]}: type a whole number, or leave it empty.`);
    if (milestones.some((m) => (m.views.trim() || m.amount.trim()) && !(Number(num(m.views)) > 0 && Number(num(m.amount)) > 0))) return setError("Give each milestone both its views and what it pays, or remove it.");
    const checked = campaignSchema.safeParse(input);
    if (!checked.success) return setError(firstProblem(checked.error));
    setError(null);
    setBusy(true);
    const r = mode === "create" ? await createCampaignAction(input) : await updateCampaignAction(campaignId!, input);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (mode === "create" && "id" in r) {
      toast("Campaign saved as a draft. Add its tasks next.", "success");
      router.push(`/dashboard/creators/${r.id}/tasks`);
    } else {
      toast("Saved.", "success");
      router.refresh();
    }
  }

  const togglePlatform = (p: Platform) => setPlatforms((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));
  const section = "flex flex-col gap-4 p-5 sm:p-6";

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <GlassCard className={section}>
        <h2 className="text-lg font-semibold tracking-[-0.02em]">The campaign</h2>
        <Field label="Name" required hint="Creators see it on the application page.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Kigali summer challenge" />
        </Field>
        <Field label="Brief" required hint="The challenge and what the posts should show.">
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} maxLength={4000} placeholder="Show how you enjoy our juice on a hot day. Film in a real place, with the bottle in view." />
        </Field>
        <Field label="Your rules" hint="Shown before creators apply and on every task. Optional.">
          <Textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={4} maxLength={4000} placeholder="No other brands in the video. Keep it family friendly." />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Platforms</legend>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button key={p} type="button" aria-pressed={platforms.includes(p)} onClick={() => togglePlatform(p)} className={cn("min-h-11 cursor-pointer rounded-full border px-4 text-[15px] font-medium", platforms.includes(p) ? "border-transparent bg-brand-gradient text-white" : "border-line text-text hover:bg-soft")}>
                {PLATFORM_LABEL[p]}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-muted">Instagram must be a professional account and Facebook a Page: personal accounts cannot share their views.</p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First day" required hint={draft ? undefined : "Fixed once the campaign went live."}>
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} disabled={!draft} />
          </Field>
          <Field label="Last day" required>
            <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} disabled={!draft} min={startsOn} />
          </Field>
        </div>
        <Field label="Required mentions" hint="The caption must contain one of these: @yourhandle, #yourhashtag or a link. Separate them with spaces. Empty: no check.">
          <Input value={mentions} onChange={(e) => setMentions(e.target.value)} placeholder="@yourbrand #yourchallenge" autoCapitalize="off" />
        </Field>
      </GlassCard>

      <GlassCard className={section}>
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Pay</h2>
          <p className="text-[14px] text-muted">Use any mix. Pay is worked out for each 30-day period and paid at its end. You pay creators yourself, by Mobile Money.</p>
        </div>
        <Field label="Currency" hint={draft ? undefined : "Fixed once the campaign went live."}>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!draft}>
            {[...new Set([currency, ...CURRENCIES])].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Per 1,000 views (${currency})`}>
            <Input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="2000" />
          </Field>
          <Field label={`Per post handed in (${currency})`}>
            <Input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Milestones</legend>
          <p className="text-[13px] text-muted">A one-off amount when a post reaches a number of views. Paid once per post.</p>
          {milestones.map((m, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label="Views" className="flex-1">
                <Input inputMode="numeric" value={m.views} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, views: e.target.value } : x)))} placeholder="10000" />
              </Field>
              <Field label={`Pays (${currency})`} className="flex-1">
                <Input inputMode="numeric" value={m.amount} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="5000" />
              </Field>
              <button type="button" aria-label="Remove this milestone" onClick={() => setMilestones(milestones.filter((_, j) => j !== i))} className="mb-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
                <Trash2 aria-hidden className="size-5" />
              </button>
            </div>
          ))}
          {milestones.length < 10 && (
            <Button type="button" variant="outline" size="sm" className="self-start" leading={<Plus aria-hidden className="size-4" />} onClick={() => setMilestones([...milestones, { views: "", amount: "" }])}>
              Add a milestone
            </Button>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Most one post earns in a period (${currency})`}>
            <Input inputMode="numeric" value={capPost} onChange={(e) => setCapPost(e.target.value)} placeholder="No limit" />
          </Field>
          <Field label={`Most one creator earns in a period (${currency})`}>
            <Input inputMode="numeric" value={capCreator} onChange={(e) => setCapCreator(e.target.value)} placeholder="No limit" />
          </Field>
        </div>
        {words.length > 0 && (
          <div className="rounded-2xl bg-soft p-4 text-[14px]">
            <p className="mb-1 font-semibold">Creators will read</p>
            <ul className="list-disc pl-5">
              {words.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {mode === "edit" && !draft && <p className="text-[13px] text-muted">New pay rules count for the pay period running now and the ones after it. Periods already closed keep what they paid.</p>}
      </GlassCard>

      <GlassCard className={section}>
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Goals for each period</h2>
          <p className="text-[14px] text-muted">
            Views past a target do not earn. When all creators together pass the campaign target, everyone&apos;s counted views shrink by the same share. Leave empty for no limit.
            {mode === "edit" && !draft ? " Changes here go to the periods that have not started; change the running one on Payouts." : ""}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Views per creator">
            <Input inputMode="numeric" value={targetCreator} onChange={(e) => setTargetCreator(e.target.value)} placeholder="50000" />
          </Field>
          <Field label="Views of all creators">
            <Input inputMode="numeric" value={targetCampaign} onChange={(e) => setTargetCampaign(e.target.value)} placeholder="500000" />
          </Field>
          <Field label={`Budget (${currency})`} hint="Most you pay in one period, all creators together.">
            <Input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="1000000" />
          </Field>
        </div>
      </GlassCard>

      <GlassCard className={section}>
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Your questions</h2>
          <p className="text-[14px] text-muted">Asked on the application form, after name, WhatsApp, email, accounts and best posts. Optional.</p>
        </div>
        {questions.map((q, i) => (
          <div key={q.id} className="flex flex-col gap-2 rounded-2xl bg-soft p-3 sm:flex-row sm:items-end">
            <Field label={`Question ${i + 1}`} className="flex-1">
              <Input value={q.label} maxLength={200} onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Why do you like our products?" />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-[15px]">
              <input type="checkbox" className="size-5" checked={q.required} onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
              Required
            </label>
            <button type="button" aria-label={`Remove question ${i + 1}`} onClick={() => setQuestions(questions.filter((_, j) => j !== i))} className="inline-flex size-11 shrink-0 items-center justify-center self-end rounded-full text-muted hover:bg-glass hover:text-text">
              <Trash2 aria-hidden className="size-5" />
            </button>
          </div>
        ))}
        {questions.length < 10 && (
          <Button type="button" variant="outline" size="sm" className="self-start" leading={<Plus aria-hidden className="size-4" />} onClick={() => setQuestions([...questions, { id: `q${Date.now().toString(36)}`, label: "", required: false }])}>
            Add a question
          </Button>
        )}
      </GlassCard>

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[15px] font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Saving…" : mode === "create" ? "Save as a draft" : "Save changes"}
        </Button>
        {mode === "create" && <p className="self-center text-[14px] text-muted">It goes live when you say so, after you add its tasks.</p>}
      </div>
    </form>
  );
}
