"use client";

// Steps 1 to 5 of the campaign wizard: Idea, Goal, Creators, Where, When (docs/CREATOR_CAMPAIGN_WIZARD.md).

import { Camera, Clapperboard, Download, Eye, Globe, Image as ImageIcon, MapPin, ShoppingBag, UserPlus } from "lucide-react";
import { Field, Input, Textarea } from "@/components/ui";
import { NetworkIcon } from "@/components/connections/network-icon";
import { formatShortDate } from "@/components/analytics/format";
import { cn } from "@/lib/cn";
import { taskSpans, type Platform } from "@/lib/creators/company-forms";
import { periodsFor, daysInclusive } from "@/lib/creators/periods";
import { searchPlaces } from "@/lib/creators/places";
import { FOLLOWER_STEPS, LANGUAGES, NICHES } from "@/lib/creators/requirements";
import { BRIEF_EVERY, CAMPAIGN_GOALS, CAMPAIGN_KINDS, POST_FORMATS } from "@/lib/creators/wizard";
import { MAX_IDEA, REPEAT_OF, type TaskMedia } from "@/lib/creators/wizard-steps";
import { hashtagOf } from "@/lib/creators/wizard-suggest";
import { addDaysYmd } from "@/lib/demo/slots";
import type { Network } from "@/lib/social/types";
import { ChipGroup, ChoiceCards, NumberSlider, Question, SearchPicker, Segmented, Stepper, StopSlider, TagInput, toggle } from "./controls";
import type { StepProps } from "./wizard";

export function IdeaStep({ a, set, o }: StepProps) {
  const kind = CAMPAIGN_KINDS.find((k) => k.value === a.kind);
  return (
    <div className="flex flex-col gap-7">
      <Question label="Your idea in one line" id="q-idea">
        <Textarea aria-labelledby="q-idea" rows={2} maxLength={MAX_IDEA} value={a.idea} onChange={(e) => set({ idea: e.target.value })} placeholder={`For example: ${o.ideaExamples[0]}`} className="min-h-20 text-[16px]" />
        <div className="flex flex-wrap gap-2" aria-label="Examples">
          {o.ideaExamples.map((ex) => (
            <button key={ex} type="button" onClick={() => set({ idea: ex })} className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-dashed border-line px-3.5 text-left text-[14px] text-muted hover:bg-soft hover:text-text">
              {ex}
            </button>
          ))}
        </div>
      </Question>

      <Question label="What kind of campaign is it?" hint={kind ? kind.hint : "Pick the closest one. Not sure? Leave it: the AI picks."} id="q-kind">
        <div role="radiogroup" aria-labelledby="q-kind" className="flex flex-wrap gap-2">
          {CAMPAIGN_KINDS.map((k) => (
            <button key={k.value} type="button" role="radio" aria-checked={a.kind === k.value} onClick={() => set({ kind: a.kind === k.value ? null : k.value })} className={cn("min-h-11 cursor-pointer rounded-full border px-4 text-[14px] font-medium", a.kind === k.value ? "border-transparent bg-brand-gradient text-white" : "glass text-text")}>
              {k.label}
            </button>
          ))}
        </div>
      </Question>

      <Field label="Campaign name" hint="Creators see it. Leave it empty and we suggest one.">
        <Input value={a.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder={o.campaignId ? "Kigali juice challenge" : "We suggest one from your idea"} />
      </Field>

      <Question label="Does it promote one of your campaigns?" hint="From Business info. Its products and dates are used. Optional." id="q-kc">
        {o.knowledgeCampaigns.length ? (
          <SearchPicker label="Business info campaign" multiple={false} options={o.knowledgeCampaigns} selected={a.knowledgeCampaignId ? [a.knowledgeCampaignId] : []} onChange={(ids) => set({ knowledgeCampaignId: ids[0] ?? null })} placeholder="Search your campaigns" emptyText="No campaign with that name." />
        ) : (
          <p className="text-[14px] text-muted">No campaigns in Business info yet. That&apos;s fine.</p>
        )}
      </Question>

      <Question label="Which products?" hint="Creators show these. Optional." id="q-products">
        {o.products.length ? (
          <SearchPicker label="Products" options={o.products} selected={a.productIds} onChange={(ids) => set({ productIds: ids })} placeholder="Search your products" emptyText="No product with that name." />
        ) : (
          <p className="text-[14px] text-muted">No products in Business info yet. Add them there and they show up here.</p>
        )}
      </Question>
    </div>
  );
}

const GOAL_ICON = { VIEWS: Eye, SALES: ShoppingBag, VISITS: MapPin, FOLLOWERS: UserPlus, DOWNLOADS: Download } as const;

export function GoalStep({ a, set }: StepProps) {
  return (
    <ChoiceCards
      label="What you want from the campaign"
      value={a.goal}
      onChange={(goal) => set({ goal })}
      options={CAMPAIGN_GOALS.map((g) => {
        const Icon = GOAL_ICON[g.value];
        return { value: g.value, label: g.label, hint: g.hint, icon: <Icon aria-hidden className="size-5" /> };
      })}
    />
  );
}

const followers = (n: number) => (n === 0 ? "Any number" : `${n.toLocaleString("en-US")}+ followers`);

export function CreatorsStep({ a, set, o }: StepProps) {
  const r = a.requirements;
  const req = (patch: Partial<typeof r>) => set({ requirements: { ...r, ...patch } });
  const wanted = Math.min(o.creatorsPerCampaign, Math.max(1, r.creatorsWanted ?? Math.min(5, o.creatorsPerCampaign)));
  return (
    <div className="flex flex-col gap-7">
      <p className="rounded-2xl bg-soft px-4 py-3 text-[14px] text-muted">Creators who don&apos;t match can still apply. You see who matches first, and why the others don&apos;t.</p>
      <Question label="What do they post about?" hint="Pick up to 10." id="q-niches">
        <ChipGroup label="Topics" options={NICHES} selected={r.niches} onToggle={(v) => req({ niches: toggle(r.niches, v).slice(0, 10) })} />
      </Question>
      <Question label="Where do they live?" hint="Empty: anywhere." id="q-places">
        <SearchPicker label="Places" options={r.locations.map((l) => ({ id: l, label: l }))} search={(q) => searchPlaces(q).map((p) => ({ id: p, label: p }))} selected={r.locations} onChange={(locations) => req({ locations: locations.slice(0, 20) })} placeholder="Search a district or city, e.g. Gasabo" free max={20} />
      </Question>
      <Question label="Which languages do they post in?" id="q-lang">
        <ChipGroup label="Languages" options={LANGUAGES} selected={r.languages} onToggle={(v) => req({ languages: toggle(r.languages, v) })} />
      </Question>
      <Question label="Followers, at least" hint="On at least one of their accounts." id="q-followers">
        <StopSlider label="Least followers" stops={FOLLOWER_STEPS} value={r.minFollowers ?? 0} onChange={(v) => req({ minFollowers: v || null })} format={followers} />
      </Question>
      <Question label="How many creators do you want?" hint={`Your plan allows up to ${o.creatorsPerCampaign} in one campaign.`} id="q-wanted">
        <NumberSlider label="Creators wanted" min={1} max={o.creatorsPerCampaign} value={wanted} onChange={(v) => req({ creatorsWanted: v })} format={(n) => `${n} ${n === 1 ? "creator" : "creators"}`} />
      </Question>
    </div>
  );
}

const ICONS: readonly string[] = ["instagram", "facebook", "tiktok", "youtube", "linkedin"];
const asMention = (v: string) => (/^[@#]|^https?:\/\//i.test(v) ? v : (hashtagOf(v) ?? v));

export function WhereStep({ a, set, o }: StepProps) {
  const suggestions = [o.handle, hashtagOf(a.name)].filter((m): m is string => Boolean(m));
  return (
    <div className="flex flex-col gap-7">
      <Question label="Networks" hint="BuPulse counts the views on these. Instagram must be a professional account and Facebook a Page." id="q-networks">
        <div role="group" aria-labelledby="q-networks" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {o.networks.map((n) => {
            const on = a.platforms.includes(n.network as Platform);
            return (
              <button
                key={n.network}
                type="button"
                aria-pressed={on}
                disabled={n.soon}
                onClick={() => set({ platforms: toggle(a.platforms, n.network as Platform) })}
                className={cn("flex min-h-16 cursor-pointer flex-col items-start gap-1.5 rounded-2xl border px-3.5 py-3 text-left disabled:cursor-not-allowed", on ? "border-pulse-blue bg-ok-bg/60 shadow-ring" : "border-line bg-glass hover:bg-soft", n.soon && "opacity-60 hover:bg-glass")}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  {ICONS.includes(n.network) ? <NetworkIcon network={n.network as Network} className="size-6" /> : <Globe aria-hidden className="size-6 text-muted" />}
                  {n.soon ? <span className="rounded-full bg-soft px-2 py-0.5 text-[11px] font-semibold text-muted">Coming soon</span> : on && <span className="size-2.5 rounded-full bg-pulse-blue" aria-hidden />}
                </span>
                <span className="text-[14px] font-semibold">{n.label}</span>
              </button>
            );
          })}
        </div>
      </Question>
      {a.platforms.length > 1 && (
        <Question label="How many posts per task?" id="q-mode">
          <Segmented
            label="Post on"
            value={a.platformMode}
            onChange={(platformMode) => set({ platformMode })}
            options={[
              { value: "ANY", label: "One, on any of them" },
              { value: "ALL", label: "One on each of them" },
            ]}
          />
        </Question>
      )}
      <Question label="What kind of posts?" id="q-formats">
        <ChipGroup label="Post types" options={POST_FORMATS} selected={a.formats} onToggle={(v) => set({ formats: toggle(a.formats, v as (typeof a.formats)[number]) })} />
      </Question>
      <Question label="What must the caption say?" hint="The caption must have one of these: your @account, a #hashtag or a link. Empty: no check." id="q-mentions">
        <TagInput label="Required mentions" values={a.mentions} onChange={(mentions) => set({ mentions })} placeholder="@yourbrand #yourhashtag" suggestions={suggestions} normalize={asMention} />
      </Question>
    </div>
  );
}

const PRESETS = [
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 60, label: "2 months" },
  { days: 90, label: "3 months" },
];

const MEDIA = [
  { value: "VIDEO" as TaskMedia, label: "Video", icon: <Clapperboard aria-hidden className="size-5" /> },
  { value: "IMAGE" as TaskMedia, label: "Photo", icon: <Camera aria-hidden className="size-5" /> },
  { value: "ANY" as TaskMedia, label: "Either", icon: <ImageIcon aria-hidden className="size-5" /> },
];

export function WhenStep({ a, set, o }: StepProps) {
  const draft = o.status === "DRAFT";
  const days = daysInclusive(a.startsOn, a.endsOn);
  const good = days >= 1;
  const periods = good ? periodsFor(a.startsOn, a.endsOn, "UTC").length : 0;
  const every = a.briefEvery ?? "MONTH";
  const count = (b: (typeof BRIEF_EVERY)[number]["value"]) => (good ? taskSpans(a.startsOn, a.endsOn, REPEAT_OF[b]).length : 0);
  const hints = { MONTH: `One task for all ${days} days.`, WEEK: `${count("WEEK")} tasks, a new one each week.`, DAY: `${count("DAY")} tasks, a new one each day.` };
  return (
    <div className="flex flex-col gap-7">
      <Question label="First and last day" hint={draft ? "In your timezone. A campaign runs for a year at most." : "Fixed once the campaign went live."} id="q-dates">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First day">
            <Input type="date" value={a.startsOn} min={o.today} disabled={!draft} onChange={(e) => e.target.value && set({ startsOn: e.target.value, endsOn: e.target.value > a.endsOn ? e.target.value : a.endsOn })} />
          </Field>
          <Field label="Last day">
            <Input type="date" value={a.endsOn} min={a.startsOn} disabled={!draft} onChange={(e) => e.target.value && set({ endsOn: e.target.value })} />
          </Field>
        </div>
        {draft && (
          <div className="flex flex-wrap gap-2" aria-label="Quick lengths">
            {PRESETS.map((p) => {
              const end = addDaysYmd(a.startsOn, p.days - 1);
              return (
                <button key={p.days} type="button" aria-pressed={a.endsOn === end} onClick={() => set({ endsOn: end })} className={cn("min-h-11 cursor-pointer rounded-full border px-4 text-[14px] font-medium", a.endsOn === end ? "border-transparent bg-brand-gradient text-white" : "glass text-text")}>
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
        {good && (
          <p className="text-[14px] text-muted">
            {formatShortDate(a.startsOn)} to {formatShortDate(a.endsOn)}: {days} {days === 1 ? "day" : "days"}, {periods} pay {periods === 1 ? "period" : "periods"} (creators are paid every 30 days).
          </p>
        )}
      </Question>
      <Question label="How often do creators get a new brief?" id="q-every">
        <ChoiceCards label="New brief" columns={1} value={every} onChange={(briefEvery) => set({ briefEvery })} options={BRIEF_EVERY.map((b) => ({ value: b.value, label: b.label, hint: good ? hints[b.value] : undefined }))} />
      </Question>
      <Question label="Posts a day" hint={draft ? "How many posts each creator hands in every day." : "Change it on each task, in step Content."} id="q-ppd">
        <Stepper label="Posts a day" min={1} max={10} value={a.postsPerDay} disabled={!draft} onChange={(postsPerDay) => set({ postsPerDay })} unit={(n) => `${n} a day`} />
      </Question>
      <Question label="Video or photo?" id="q-media">
        <ChoiceCards label="Media" columns={3} value={a.mediaKind} onChange={(mediaKind) => draft && set({ mediaKind })} options={MEDIA.map((m) => ({ ...m, disabled: !draft }))} />
      </Question>
    </div>
  );
}
