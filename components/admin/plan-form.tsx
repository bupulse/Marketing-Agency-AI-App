"use client";

import { Check } from "lucide-react";
import { useActionState, useState } from "react";
import { savePlanAction, type PlanFormState } from "@/app/admin/(console)/(money)/plans/actions";
import { formatCents } from "@/components/billing/helpers";
import { Badge, Button, Field, GlassCard, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { FEATURES, dependentsOf, featureLabel, withPrerequisites, type FeatureKey } from "@/lib/features";
import { USAGE_METRICS, type PlanLimits, type PlanStatus, POSTS_PER_APP_MAX, POSTS_PER_APP_MIN, postsPerAppLimit, VIDEOS_PER_DAY } from "@/lib/plans";

export type PlanFormInitial = {
  key: string;
  name: string;
  description: string;
  isTrial: boolean;
  trialDays: number | null;
  status: PlanStatus;
  sortOrder: number;
  highlight: boolean;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  limits: PlanLimits;
  highlights: string[];
  features: FeatureKey[];
};

const METRIC_LABELS: Record<string, string> = {
  text: "Text generations",
  image: "Brand designs",
  chat: "Chat widget replies",
  videos: "Videos a month",
  voiceCharacters: "Voice characters",
  seats: "Team seats",
  postsPerAppPerDay: "Posts per app per day",
  videosPerDay: "Videos per day",
};

const cents = (dollars: string) => {
  const n = Number(dollars.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * The feature checklist. Ticking a feature ticks what it needs; a feature another ticked one needs cannot be unticked
 * ("needed by X"); "coming soon" features are shown but disabled. The server validates the same rules (validateFeatureSet).
 */
export function FeatureChecklist({ selected, onChange }: { selected: FeatureKey[]; onChange: (next: FeatureKey[]) => void }) {
  const toggle = (key: FeatureKey, on: boolean) => {
    if (on) onChange(withPrerequisites([...selected, key]));
    else if (dependentsOf(key, selected).length === 0) onChange(selected.filter((k) => k !== key));
  };
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">What the plan unlocks</legend>
      <p className="mb-2 text-[13px] text-muted">Ticking a feature also ticks what it needs. Features sold as a service (Managed by BuPulse, own Composio account) have nothing to switch on in the app.</p>
      {FEATURES.map((f) => {
        const on = selected.includes(f.key);
        const neededBy = on ? dependentsOf(f.key, selected) : [];
        const soon = f.status === "coming_soon";
        return (
          <label key={f.key} className={cn("flex min-h-11 items-start gap-2 text-[15px]", soon && "text-muted")}>
            <input type="checkbox" name={`feature_${f.key}`} checked={on} disabled={soon || neededBy.length > 0} onChange={(e) => toggle(f.key, e.target.checked)} className="mt-1 size-5" aria-describedby={`feature_${f.key}_hint`} />
            {/* A disabled checkbox is not posted; the hidden field keeps a needed feature in the form. */}
            {on && neededBy.length > 0 && <input type="hidden" name={`feature_${f.key}`} value="on" />}
            <span>
              <span className="flex flex-wrap items-center gap-2">
                <strong>{f.label}</strong>
                {soon && <Badge tone="violet">Coming soon</Badge>}
                {f.kind === "service" && <Badge tone="neutral">Service</Badge>}
                {neededBy.length > 0 && <Badge tone="blue">Needed by {neededBy.map(featureLabel).join(", ")}</Badge>}
              </span>
              <span id={`feature_${f.key}_hint`} className="block text-[13px] text-muted">
                {f.description}
                {f.requires.length > 0 ? ` Needs ${f.requires.map(featureLabel).join(", ")}.` : ""}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** The pricing card as clients will see it (monthly price, features, badge), updated while typing. */
function CardPreview({ name, description, monthly, yearly, features, highlight, status, isTrial, trialDays }: { name: string; description: string; monthly: number; yearly: number; features: string[]; highlight: boolean; status: PlanStatus; isTrial: boolean; trialDays: number | null }) {
  const savings = monthly > 0 ? Math.round(((monthly * 12 - yearly) / (monthly * 12)) * 100) : 0;
  return (
    <GlassCard strong={highlight} padding="lg" className={cn("relative flex flex-col gap-5", highlight && "shadow-glow ring-2 ring-pulse-violet/60")} aria-label="Pricing card preview">
      {highlight && <Badge tone="violet" className="absolute top-5 right-5">Most popular</Badge>}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xl font-bold tracking-tight">{name || "Plan name"}</h3>
        <p className="text-[15px] text-muted">{description || "A short description."}</p>
      </div>
      {isTrial ? (
        <p className="text-3xl font-bold tracking-[-0.03em]">Free for {trialDays ?? 7} days</p>
      ) : (
        <div>
          <p className="flex items-baseline gap-1.5"><span className="text-4xl font-bold tracking-[-0.04em]">{formatCents(monthly)}</span><span className="text-muted">/ month</span></p>
          <p className="mt-1 text-sm text-muted">or {formatCents(yearly)} / year{savings > 0 ? ` (${savings}% off)` : ""}</p>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[15px]"><Check aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />{f}</li>
        ))}
        {features.length === 0 && <li className="text-sm text-muted">No highlights listed yet.</li>}
      </ul>
      <p className="text-xs text-muted">{status === "active" ? "Shown on the pricing page and in Billing." : status === "hidden" ? "Hidden: not shown to new clients." : "Retired: closed to new sign-ups; existing clients stay."}</p>
    </GlassCard>
  );
}

export function PlanForm({ mode, initial, paddleConnected, subscribers, version }: { mode: "create" | "edit"; initial: PlanFormInitial; paddleConnected: boolean; subscribers: number; version?: string }) {
  const [state, action, pending] = useActionState<PlanFormState, FormData>(savePlanAction, {});
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [monthly, setMonthly] = useState(String(initial.monthlyPriceCents / 100));
  const [yearly, setYearly] = useState(String(initial.yearlyPriceCents / 100));
  const [highlights, setHighlights] = useState(initial.highlights.join("\n"));
  const [features, setFeatures] = useState<FeatureKey[]>(initial.features);
  const [highlight, setHighlight] = useState(initial.highlight);
  const [status, setStatus] = useState<PlanStatus>(initial.status);
  const [trialDays, setTrialDays] = useState(String(initial.trialDays ?? 7));
  // Every field is controlled, so nothing is lost when the form action finishes (React resets uncontrolled fields).
  const [key, setKey] = useState(initial.key);
  const [sortOrder, setSortOrder] = useState(String(initial.sortOrder));
  const [limits, setLimits] = useState<Record<string, string>>(Object.fromEntries([...[...USAGE_METRICS, "seats"].map((m) => [m, String(initial.limits[m as keyof PlanLimits])]), ["postsPerAppPerDay", String(postsPerAppLimit(initial.limits))], ["videosPerDay", String(initial.limits.videosPerDay ?? VIDEOS_PER_DAY)]]));
  // "Back" hides the confirm step of one particular answer; a changed price hides it too (it was not reviewed).
  const [backed, setBacked] = useState<object | null>(null);
  const highlightList = highlights.split("\n").map((l) => l.trim()).filter(Boolean);
  const confirm = state.confirm && state.confirm !== backed && state.confirm.monthlyCents === cents(monthly) && state.confirm.yearlyCents === cents(yearly) ? state.confirm : null;
  const priceChanged = mode === "edit" && !initial.isTrial && (cents(monthly) !== initial.monthlyPriceCents || cents(yearly) !== initial.yearlyPriceCents);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <form action={action} className="flex min-w-0 flex-col gap-5">
        <input type="hidden" name="mode" value={mode} />
        {mode === "edit" && <input type="hidden" name="key" value={initial.key} />}
        {mode === "edit" && version && <input type="hidden" name="version" value={version} />}
        {state.error && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">{state.error}</p>}

        <GlassCard className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Basics</h2>
          {mode === "create" && (
            <Field label="Key" required hint="A short identifier such as starter or agency. It cannot be changed later.">
              <Input name="key" value={key} onChange={(e) => setKey(e.target.value)} maxLength={32} pattern="[A-Za-z][A-Za-z0-9_\-]{1,31}" placeholder="starter" required />
            </Field>
          )}
          <Field label="Name" required><Input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></Field>
          <Field label="Description" hint="One line under the name on the pricing card."><Textarea name="description" rows={2} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Order" hint="Lower comes first on the pricing page."><Input name="sortOrder" type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} required /></Field>
            {initial.isTrial ? (
              <Field label="Trial length (days)" required><Input name="trialDays" type="number" min={1} max={365} step={1} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} required /></Field>
            ) : (
              <Field label="Status" hint="Hidden or retired plans are closed to new sign-ups; clients already on them stay.">
                <Select name="status" value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)}>
                  <option value="active">Active (for sale)</option>
                  <option value="hidden">Hidden (draft)</option>
                  <option value="retired">Retired</option>
                </Select>
              </Field>
            )}
          </div>
          {!initial.isTrial && (
            <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
              <input type="checkbox" name="highlight" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} className="size-5" /> Highlight as the most popular plan
            </label>
          )}
        </GlassCard>

        {!initial.isTrial && (
          <GlassCard className="flex flex-col gap-4 p-5 sm:p-6">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Price (US dollars)</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Per month" required><Input name="monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} required /></Field>
              <Field label="Per year" required><Input name="yearly" inputMode="decimal" value={yearly} onChange={(e) => setYearly(e.target.value)} required /></Field>
            </div>
            <p className="text-[13px] text-muted">
              {!paddleConnected
                ? "Paddle is not connected: prices are saved as a draft and created in Paddle once it is."
                : mode === "create"
                  ? "Saving creates the product and both prices in Paddle."
                  : priceChanged
                    ? `Changing the price creates new Paddle prices. ${subscribers} current ${subscribers === 1 ? "client moves" : "clients move"} at their next renewal (increases after a 30-day email notice).`
                    : "Changing a price creates new Paddle prices; existing clients move at their next renewal."}
            </p>
          </GlassCard>
        )}

        <GlassCard className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Limits {initial.isTrial ? "(for the whole trial)" : "(per month)"}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {([...USAGE_METRICS, "seats"] as const).map((m) => (
              <Field key={m} label={METRIC_LABELS[m]} hint={m === "seats" ? "Users per company (1 to 1000)." : undefined}><Input name={`limit_${m}`} type="number" min={m === "seats" ? 1 : 0} max={m === "seats" ? 1000 : undefined} step={1} value={limits[m]} onChange={(e) => setLimits({ ...limits, [m]: e.target.value })} required /></Field>
            ))}
            <Field label={METRIC_LABELS.postsPerAppPerDay} hint={`Posts "Create today's content" and Autopilot make per app a day for one product or campaign (${POSTS_PER_APP_MIN} to ${POSTS_PER_APP_MAX}).`}><Input name="limit_postsPerAppPerDay" type="number" min={POSTS_PER_APP_MIN} max={POSTS_PER_APP_MAX} step={1} value={limits.postsPerAppPerDay} onChange={(e) => setLimits({ ...limits, postsPerAppPerDay: e.target.value })} required /></Field>
            <Field label={METRIC_LABELS.videosPerDay} hint="Videos BuPulse makes a day at most (Kigali day). Each video is at most 30 seconds; the monthly number is Videos a month."><Input name="limit_videosPerDay" type="number" min={0} max={100} step={1} value={limits.videosPerDay} onChange={(e) => setLimits({ ...limits, videosPerDay: e.target.value })} required /></Field>
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Features</h2>
          <FeatureChecklist selected={features} onChange={setFeatures} />
        </GlassCard>

        <GlassCard className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Highlights</h2>
          <Field label="Bullets on the pricing card" hint="Marketing words only; they do not switch anything on. One per line, up to 12."><Textarea name="highlights" rows={6} value={highlights} onChange={(e) => setHighlights(e.target.value)} /></Field>
        </GlassCard>

        {confirm ? (
          <GlassCard role="alertdialog" aria-label="Confirm price change" className="flex flex-col gap-3 border border-pulse-violet/50 p-5 sm:p-6">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Confirm the price change</h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
              {confirm.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
            <p className="text-[13px] text-muted">New Paddle prices are created first. If Paddle refuses, nothing is changed. You can stop a waiting change later from this plan&apos;s page.</p>
            <input type="hidden" name="previewMonthly" value={confirm.monthlyCents} />
            <input type="hidden" name="previewYearly" value={confirm.yearlyCents} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="confirmPrice" value="1" disabled={pending}>{pending ? "Saving…" : "Confirm and change the price"}</Button>
              <Button type="button" variant="outline" onClick={() => setBacked(state.confirm ?? null)} disabled={pending}>Back</Button>
            </div>
          </GlassCard>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : priceChanged ? "Review price change" : mode === "create" ? "Create plan" : "Save changes"}</Button>
          </div>
        )}
      </form>

      <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4">
        <h2 className="px-1 text-sm font-medium text-muted">Preview</h2>
        <CardPreview name={name} description={description} monthly={cents(monthly)} yearly={cents(yearly)} features={highlightList} highlight={highlight} status={status} isTrial={initial.isTrial} trialDays={Number(trialDays) || null} />
      </div>
    </div>
  );
}
