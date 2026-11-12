"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { Code2, ExternalLink, Globe, Palette, PanelLeftClose, PanelRightClose, X } from "lucide-react";
import { saveWidgetSettings } from "@/app/dashboard/widget/actions";
import { ChoiceCards, SuggestionChips } from "@/components/app/kit/c-choice";
import { SectionTabs, TabPanel } from "@/components/app/kit/c-steps";
import { Button, Field, GlassCard, Input, Meter, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { InstallGuide } from "./install-guide";
import { normalizeDomain } from "@/lib/widget/origin";

interface Settings {
  enabled: boolean;
  greeting: string;
  position: "right" | "left";
  accentColor: string;
  allowedDomains: string[];
}

export function WidgetSettings({
  initial,
  defaultGreeting,
  defaultAccent,
  brandColors,
  widgetKey,
  baseUrl,
  usage,
  lockedBySupport = false,
  greetingIdeas = [],
  suggestedDomains = [],
}: {
  initial: Settings;
  defaultGreeting: string;
  defaultAccent: string;
  brandColors: string[];
  widgetKey: string;
  baseUrl: string;
  usage: { used: number; limit: number };
  /** Support switched the chat off: the switch stays off until support turns it back on. */
  lockedBySupport?: boolean;
  /** Ready greetings to tap (in the business's language). */
  greetingIdeas?: string[];
  /** The business's own website(s), offered as one tap. */
  suggestedDomains?: string[];
}) {
  const [s, setS] = useState<Settings>(initial);
  const [domainInput, setDomainInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  // Start where something is missing: no allowed website yet opens "Your website".
  const [tab, setTab] = useState<"look" | "where" | "install">(initial.allowedDomains.length ? "look" : "where");
  const [pending, start] = useTransition();
  const { toast } = useToast();

  const update = (patch: Partial<Settings>) => {
    setS((cur) => ({ ...cur, ...patch }));
    setDirty(true);
  };

  function addDomain() {
    const raw = domainInput.trim();
    if (!raw) return;
    const domain = normalizeDomain(raw);
    if (!domain) {
      setErrors((e) => ({ ...e, allowedDomains: `"${raw}" is not a website address. Use something like mysite.com.` }));
      return;
    }
    setErrors((e) => ({ ...e, allowedDomains: "" }));
    if (!s.allowedDomains.includes(domain)) update({ allowedDomains: [...s.allowedDomains, domain] });
    setDomainInput("");
  }

  function onDomainKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDomain();
    }
  }

  function save() {
    setErrors({});
    start(async () => {
      const result = await saveWidgetSettings(s);
      if (result.ok) {
        setDirty(false);
        setPreviewKey((k) => k + 1);
        toast("Website chat saved.", "success");
      } else {
        setErrors(result.errors);
      }
    });
  }

  const accent = s.accentColor || defaultAccent;
  const swatches = [...new Set([...brandColors, defaultAccent])];
  const previewSrc = `/widget/${widgetKey}?mode=preview`;
  const pct = usage.limit > 0 ? usage.used : 0;

  const on = s.enabled && !lockedBySupport;
  const saveBar = (
    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button onClick={save} disabled={pending || !dirty}>{pending ? "Saving…" : "Save"}</Button>
      <span className="text-[13px] text-muted">{dirty ? "You have changes to save." : "Changes go live on your website as soon as you save."}</span>
      {errors.form && <span className="text-sm text-danger">{errors.form}</span>}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-4">
        <GlassCard as="section" aria-label="Website chat on or off" className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-[16px] font-bold">{on ? "The chat is on" : "The chat is off"}</p>
              <p className="text-[13.5px] text-muted">
                {usage.limit > 0 ? `${usage.used.toLocaleString("en-US")} of ${usage.limit.toLocaleString("en-US")} AI replies used this month.` : "Visitors can leave their details."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="Website chat"
              disabled={lockedBySupport}
              onClick={() => update({ enabled: !s.enabled })}
              className={cn("relative h-8 w-14 shrink-0 rounded-full transition-colors motion-reduce:transition-none", lockedBySupport ? "cursor-not-allowed opacity-60" : "cursor-pointer", on ? "bg-brand-gradient" : "bg-line")}
            >
              <span className={cn("absolute top-1 size-6 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none", on ? "left-7" : "left-1")} />
            </button>
          </div>
          {usage.limit > 0 && <Meter value={pct} max={usage.limit} label="AI replies used" />}
          {lockedBySupport && (
            <p role="status" className="rounded-2xl bg-soft p-3 text-[14px]">
              <strong>Website chat is switched off.</strong> Our team turned it off for your account. <a href="/contact" className="underline">Contact support</a> to switch it back on.
            </p>
          )}
          {dirty && s.enabled !== initial.enabled && (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
              <span className="text-[13px] text-muted">Save to switch it {s.enabled ? "on" : "off"} on your website.</span>
            </div>
          )}
        </GlassCard>

        <SectionTabs
          label="Website chat settings"
          idPrefix="w"
          current={tab}
          onChange={setTab}
          tabs={[
            { id: "look", label: "How it looks", hint: "Greeting, place, colour", icon: Palette },
            { id: "where", label: "Your website", hint: s.allowedDomains.length ? `${s.allowedDomains.length} allowed` : "Not set yet", icon: Globe, badge: s.allowedDomains.length ? undefined : <span aria-label="Needs you" className="block size-2.5 rounded-full bg-amber-500" /> },
            { id: "install", label: "Put it on your site", hint: "Code and a guide", icon: Code2 },
          ]}
        />

        {tab === "look" && (
          <TabPanel idPrefix="w" current={tab} title="How it looks" hint="What visitors see when they open your website.">
            <Field label="Greeting" hint="Tap an idea below, or write your own." error={errors.greeting || undefined}>
              <Textarea rows={2} maxLength={300} value={s.greeting} placeholder={defaultGreeting} onChange={(e) => update({ greeting: e.target.value })} />
            </Field>
            <SuggestionChips label="Greeting ideas" items={[defaultGreeting, ...greetingIdeas].filter((g) => g !== (s.greeting || defaultGreeting))} onPick={(g) => update({ greeting: g === defaultGreeting ? "" : g })} className="-mt-2" />

            <div className="flex flex-col gap-2">
              <span className="text-[14px] font-medium">Where the bubble sits</span>
              <ChoiceCards
                label="Where the bubble sits"
                value={s.position}
                onChange={(position) => update({ position })}
                options={[
                  { value: "right", label: "Bottom right", hint: "Where most websites put it", icon: PanelRightClose },
                  { value: "left", label: "Bottom left", hint: "When something else is on the right", icon: PanelLeftClose },
                ]}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[14px] font-medium">Colour</span>
              <div className="flex flex-wrap items-center gap-2">
                {swatches.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Use ${c}`}
                    aria-pressed={accent.toLowerCase() === c.toLowerCase()}
                    onClick={() => update({ accentColor: c })}
                    className={cn("size-10 cursor-pointer rounded-full border-[3px] transition-transform duration-200 hover:scale-110 motion-reduce:transform-none", accent.toLowerCase() === c.toLowerCase() ? "border-text" : "border-surface ring-1 ring-line")}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input type="color" aria-label="Custom colour" value={accent} onChange={(e) => update({ accentColor: e.target.value })} className="size-10 cursor-pointer rounded-full border border-line bg-transparent p-0.5" />
                {s.accentColor && (
                  <Button variant="outline" size="sm" onClick={() => update({ accentColor: "" })}>Use brand colour</Button>
                )}
              </div>
              {errors.accentColor && <p className="text-[13px] text-danger">{errors.accentColor}</p>}
            </div>
            {saveBar}
          </TabPanel>
        )}

        {tab === "where" && (
          <TabPanel idPrefix="w" current={tab} title="Your website" hint="Only these websites can show your chat, so nobody else uses up your monthly replies. Smaller parts of the site (shop.mysite.com) are included.">
            {suggestedDomains.filter((d) => !s.allowedDomains.includes(d)).length > 0 && (
              <SuggestionChips label="Your websites" items={suggestedDomains.filter((d) => !s.allowedDomains.includes(d)).map((d) => `+ ${d}`)} onPick={(d) => update({ allowedDomains: [...s.allowedDomains, d.slice(2)] })} />
            )}
            <Field label="Add a website" hint="Type it, then press Enter." error={errors.allowedDomains || undefined}>
              <Input value={domainInput} placeholder="mysite.com" onChange={(e) => setDomainInput(e.target.value)} onKeyDown={onDomainKey} onBlur={addDomain} />
            </Field>
            {s.allowedDomains.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Allowed websites">
                {s.allowedDomains.map((d) => (
                  <li key={d} className="inline-flex items-center gap-1.5 rounded-full border-2 border-pulse-blue/40 bg-pulse-blue/[0.06] py-1 pr-1 pl-4 text-[14px] font-medium">
                    {d}
                    <button type="button" aria-label={`Remove ${d}`} onClick={() => update({ allowedDomains: s.allowedDomains.filter((x) => x !== d) })} className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-soft">
                      <X aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="alert" className="rounded-2xl bg-soft p-3 text-[13px]">
                <strong>No websites added.</strong> Anyone who copies your code can show your chat on their site and use up your monthly chat replies. Add your website above to keep it yours.
              </p>
            )}
            {saveBar}
          </TabPanel>
        )}

        {tab === "install" && (
          <TabPanel idPrefix="w" current={tab} title="Put it on your website" hint="Choose where your website is built. You get the exact code and a step-by-step guide.">
            <InstallGuide bare baseUrl={baseUrl} widgetKey={widgetKey} accent={accent} />
            <p className="text-[13px] text-muted">When you reach the monthly reply limit, the chat keeps collecting visitors’ contact details, without AI answers.</p>
          </TabPanel>
        )}
      </div>

      <GlassCard as="aside" aria-labelledby="w-preview" className="flex h-fit flex-col gap-3 p-4 lg:sticky lg:top-6">
        <div className="flex items-center justify-between gap-2 px-1">
          <h2 id="w-preview" className="text-lg font-semibold tracking-[-0.02em]">Live preview</h2>
          <a href={`/widget/${widgetKey}?mode=page`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
            Open <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </div>
        <iframe key={previewKey} src={previewSrc} title="Chat preview" className="h-[480px] w-full overflow-hidden rounded-2xl border border-line bg-white lg:h-[560px]" />
        <p className="px-1 text-[12.5px] text-muted">This is the real chat: try it. Test replies count towards your monthly chat replies, and contact details you enter appear in Leads.</p>
      </GlassCard>
    </div>
  );
}
