"use client";

import { useState, type FormEvent } from "react";
import { Clapperboard, Clock3, Gift, MousePointerClick, Palette, Type } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { RadioChips, SwitchRow } from "@/components/admin/kit/form-choices";
import { BannerBar } from "@/components/marketing/site-banner";
import { cn } from "@/lib/cn";
import { bannerFromForm, cleanSiteBanner, isoToKigaliLocal, LIMITS, type SiteBanner } from "@/lib/site-banner";

// Admin -> Settings -> Site banner: every part of the banner above the menu (lib/site-banner.ts), with a live preview
// that follows the form as the owner types. The preview is the real banner component.

const SWATCHES: { value: SiteBanner["color"]; label: string; bg: string }[] = [
  { value: "brand", label: "BuPulse blue", bg: "linear-gradient(90deg,#2f6bff,#7b5cff)" },
  { value: "red", label: "Red", bg: "#d91f26" },
  { value: "orange", label: "Orange", bg: "#ff7a1a" },
  { value: "black", label: "Black", bg: "#0b0b0f" },
  { value: "green", label: "Green", bg: "#0f7a3d" },
  { value: "gold", label: "Gold (Christmas)", bg: "#f5b70a" },
  { value: "custom", label: "Your own", bg: "conic-gradient(#d91f26,#f5b70a,#0f7a3d,#2f6bff,#7b5cff,#d91f26)" },
];

/** The luxury styles (moving metallic gold, app/globals.css .banner-lux-*): bigger tiles that show the real effect. */
const LUXURY: { value: SiteBanner["color"]; label: string; hint: string }[] = [
  { value: "gold-metal", label: "Gold metal", hint: "Polished gold that flows, with a light sweeping across." },
  { value: "black-gold", label: "Black and gold", hint: "Black with gold letters, gold rings and orbs." },
  { value: "red-gold", label: "Red and gold", hint: "Christmas red velvet with gold letters and rings." },
];

/** The preview from what the form holds now: invalid or half-typed parts keep the last good value. */
function previewFrom(form: HTMLFormElement, last: SiteBanner): SiteBanner {
  const raw = bannerFromForm((k) => {
    const v = new FormData(form).get(k);
    return typeof v === "string" ? v : null;
  });
  const lenient = { ...last, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "invalid")) };
  try {
    return cleanSiteBanner(lenient);
  } catch {
    return { ...last, ...(lenient as Partial<SiteBanner>) };
  }
}

export function BannerEditor({ banner, action }: { banner: SiteBanner; action: (f: FormData) => Promise<void> }) {
  const [draft, setDraft] = useState<SiteBanner>(banner);
  const [countdownOn, setCountdownOn] = useState(banner.countdownAt !== null);
  const update = (e: FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    setCountdownOn(new FormData(form).get("countdownOn") === "on");
    setDraft((last) => previewFrom(form, last));
  };

  return (
    <form action={action} onChange={update} onInput={update} className="flex flex-col gap-6">
      <input type="hidden" name="bannerPanel" value="1" />

      {/* Live preview: the real banner, sticky at the top of the form while editing. */}
      <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-3xl border border-line bg-surface p-3 shadow-glass">
        <div className="flex items-center justify-between px-1 text-[13px] text-muted">
          <span className="font-semibold text-text">Live preview</span>
          <span>{draft.on ? "Shown on the site after Save" : "Off: not shown on the site"}</span>
        </div>
        <div className="overflow-hidden rounded-2xl">
          <BannerBar key={`${draft.animation}-${draft.font}`} banner={draft} onQuote={() => {}} preview />
        </div>
      </div>

      <Section icon={Type} title="Message">
        <SwitchRow name="on" defaultChecked={banner.on} label="Show the banner" hint="On every public page, above the menu. It stays in view while visitors scroll." />
        <Field label={`Message on computers (up to ${LIMITS.text} characters)`} required>
          <Input name="text" defaultValue={banner.text} maxLength={LIMITS.text} required />
        </Field>
        <Field label={`Shorter message on phones (up to ${LIMITS.mobileText})`} hint="Leave empty to use the computer message.">
          <Input name="mobileText" defaultValue={banner.mobileText} maxLength={LIMITS.mobileText} />
        </Field>
        <Field label="Font">
          <Select name="font" defaultValue={banner.font}>
            <option value="default">Site font (Geist)</option>
            <option value="bold">Bold and wide (Bricolage)</option>
            <option value="elegant">Elegant serif (Playfair)</option>
            <option value="handwritten">Handwritten (Caveat)</option>
            <option value="mono">Typewriter (mono)</option>
          </Select>
        </Field>
      </Section>

      <Section icon={Palette} title="Colour">
        <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-3">
          <legend className="mb-2 text-[13px] font-semibold text-muted">Luxury styles (they move)</legend>
          {LUXURY.map((l) => (
            <label key={l.value} className="flex cursor-pointer flex-col gap-2 rounded-2xl border border-line p-2 has-[:checked]:border-transparent has-[:checked]:ring-2 has-[:checked]:ring-pulse-blue">
              <input type="radio" name="color" value={l.value} defaultChecked={banner.color === l.value} className="sr-only" />
              <span aria-hidden className={`banner-lux-${l.value} relative flex h-12 items-center justify-center overflow-hidden rounded-xl text-sm font-bold`}>
                <span className="relative">
                  <span className={cn(l.value !== "gold-metal" && "gold-text")}>BuPulse</span> 🎄
                </span>
              </span>
              <span className="px-1 text-sm font-semibold">{l.label}</span>
              <span className="px-1 text-[12px] leading-snug text-muted">{l.hint}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
          <legend className="mb-2 text-[13px] font-semibold text-muted">Plain colours</legend>
          {SWATCHES.map((s) => (
            <label key={s.value} className="flex cursor-pointer items-center gap-2 rounded-full border border-line py-1.5 pr-3 pl-1.5 text-sm font-medium has-[:checked]:border-transparent has-[:checked]:ring-2 has-[:checked]:ring-pulse-blue">
              <input type="radio" name="color" value={s.value} defaultChecked={banner.color === s.value} className="sr-only" />
              <span aria-hidden className="size-6 rounded-full border border-black/10" style={{ background: s.bg }} />
              {s.label}
            </label>
          ))}
        </fieldset>
        <div className={cn("flex items-center gap-3", draft.color !== "custom" && "hidden")}>
          <label className="flex items-center gap-3 text-sm font-medium">
            <input type="color" name="customColor" defaultValue={banner.customColor} className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-transparent" />
            Your colour (the text turns white or dark to stay readable)
          </label>
        </div>
      </Section>

      <Section icon={Gift} title="Decoration">
        <RadioChips
          name="decor"
          legend="Big icons on the banner"
          hideLegend
          defaultValue={banner.decor}
          options={[
            { value: "christmas", label: "🎄 Christmas", hint: "A tree before the message and two gifts by the timer." },
            { value: "launch", label: "🚀 Launch", hint: "A rocket and sparkles." },
            { value: "none", label: "None", hint: "Just the words." },
          ]}
        />
      </Section>

      <Section icon={Clapperboard} title="Animation">
        <RadioChips
          name="animation"
          legend="Banner animation"
          hideLegend
          defaultValue={banner.animation}
          options={[
            { value: "none", label: "None", hint: "Still." },
            { value: "slide", label: "Slide in", hint: "Drops in when the page opens." },
            { value: "shimmer", label: "Shimmer", hint: "A light sweeps across." },
            { value: "pulse", label: "Glow", hint: "Gently brightens and dims." },
            { value: "scroll", label: "Scrolling text", hint: "The message moves like a news ticker." },
          ]}
        />
      </Section>

      <Section icon={Clock3} title="Timer and dates" hint="All times are Kigali time.">
        <SwitchRow name="countdownOn" defaultChecked={banner.countdownAt !== null} label="Show a countdown" hint="Days, hours, minutes and seconds, next to the message." />
        <div className={cn("grid gap-4 sm:grid-cols-2", !countdownOn && "hidden")}>
          <Field label="Count down to">
            <Input name="countdownAt" type="datetime-local" defaultValue={isoToKigaliLocal(banner.countdownAt)} />
          </Field>
          <Field label="When it reaches zero">
            <Select name="whenEnded" defaultValue={banner.whenEnded}>
              <option value="text">Show another message</option>
              <option value="keep">Keep the banner, hide the timer</option>
              <option value="hide">Hide the banner</option>
            </Select>
          </Field>
          <Field label="Message after zero" className="sm:col-span-2">
            <Input name="endedText" defaultValue={banner.endedText} maxLength={LIMITS.endedText} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Show from" hint="Empty: from now.">
            <Input name="showFrom" type="datetime-local" defaultValue={isoToKigaliLocal(banner.showFrom)} />
          </Field>
          <Field label="Hide after" hint="Empty: until you switch it off.">
            <Input name="hideAfter" type="datetime-local" defaultValue={isoToKigaliLocal(banner.hideAfter)} />
          </Field>
        </div>
      </Section>

      <Section icon={MousePointerClick} title="Buttons">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Banner button">
            <Select name="button" defaultValue={banner.button}>
              <option value="quote">Opens the free-quote form</option>
              <option value="link">Opens a link</option>
              <option value="none">No button</option>
            </Select>
          </Field>
          <Field label="Button words">
            <Input name="buttonLabel" defaultValue={banner.buttonLabel} maxLength={LIMITS.buttonLabel} />
          </Field>
          <Field label="Link" hint="A page of the site (/pricing) or a full https:// address." className={cn("sm:col-span-2", draft.button !== "link" && "hidden")}>
            <Input name="buttonUrl" defaultValue={banner.buttonUrl} placeholder="/pricing" />
          </Field>
        </div>
        <SwitchRow name="matchButton" defaultChecked={banner.matchButton} label="Main button in the banner's colour" hint="The top-menu and home-page button wear the banner's colour and turn BuPulse blue when the pointer is on them." />
        <RadioChips
          name="headerButton"
          legend="The site's main button (top menu and home page) while the banner shows"
          defaultValue={banner.headerButton}
          options={[
            { value: "normal", label: "Unchanged", hint: "“Get a free quote” as usual." },
            { value: "countdown", label: "Count down", hint: "Countdown and “Get a free quote” take turns; it stays on “Get a free quote” on hover. Needs the countdown on." },
            { value: "pulse", label: "Glow", hint: "Usual words with a soft pulsing glow." },
          ]}
        />
      </Section>

      <div>
        <Button type="submit">Save the banner</Button>
      </div>
    </form>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: typeof Type; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-line p-5">
      <h3 className="m-0 flex items-center gap-2 text-base font-semibold">
        <Icon aria-hidden className="size-4 text-muted" />
        {title}
        {hint && <span className="text-[13px] font-normal text-muted">· {hint}</span>}
      </h3>
      {children}
    </section>
  );
}
