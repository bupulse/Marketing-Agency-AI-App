"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { ExternalLink, X } from "lucide-react";
import { saveWidgetSettings } from "@/app/dashboard/widget/actions";
import { CopyButton } from "@/components/studio/copy-button";
import { Accordion, Button, Chip, Field, GlassCard, Input, Meter, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { normalizeDomain } from "@/lib/widget/origin";

interface Settings {
  enabled: boolean;
  greeting: string;
  position: "right" | "left";
  accentColor: string;
  allowedDomains: string[];
}

const STEPS = [
  { question: "WordPress", answer: "Go to Appearance → Theme File Editor → footer.php and paste the code just before </body>. Or use a plugin such as \"Insert Headers and Footers\" and paste it in the footer box." },
  { question: "Wix", answer: "Open Settings → Custom Code → Add Custom Code. Paste the code, choose \"Body - end\" and apply it to all pages." },
  { question: "Shopify", answer: "Go to Online Store → Themes → Edit code → theme.liquid and paste the code just before </body>." },
  { question: "Squarespace", answer: "Open Settings → Advanced → Code Injection and paste the code in the Footer box." },
  { question: "Plain HTML", answer: "Paste the code on each page just before the closing </body> tag." },
];

export function WidgetSettings({
  initial,
  defaultGreeting,
  defaultAccent,
  brandColors,
  widgetKey,
  snippet,
  usage,
}: {
  initial: Settings;
  defaultGreeting: string;
  defaultAccent: string;
  brandColors: string[];
  widgetKey: string;
  snippet: string;
  usage: { used: number; limit: number };
}) {
  const [s, setS] = useState<Settings>(initial);
  const [domainInput, setDomainInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-6">
        <GlassCard as="section" aria-labelledby="w-settings" className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="w-settings" className="text-lg font-semibold tracking-[-0.02em]">Settings</h2>
              <p className="text-[14px] text-muted">Changes go live on your website as soon as you save.</p>
            </div>
            <label className="flex cursor-pointer items-center gap-3 text-[15px] font-medium">
              {s.enabled ? "On" : "Off"}
              <button
                type="button"
                role="switch"
                aria-checked={s.enabled}
                aria-label="Website chat"
                onClick={() => update({ enabled: !s.enabled })}
                className={cn("relative h-7 w-12 cursor-pointer rounded-full transition-colors motion-reduce:transition-none", s.enabled ? "bg-brand-gradient" : "bg-line")}
              >
                <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none", s.enabled ? "left-[22px]" : "left-0.5")} />
              </button>
            </label>
          </div>

          <Field label="Greeting" hint={`Leave empty to use: "${defaultGreeting}"`} error={errors.greeting || undefined}>
            <Textarea rows={2} maxLength={300} value={s.greeting} placeholder={defaultGreeting} onChange={(e) => update({ greeting: e.target.value })} />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium">Position</span>
            <div className="flex gap-2">
              <Chip selected={s.position === "right"} onClick={() => update({ position: "right" })}>Bottom right</Chip>
              <Chip selected={s.position === "left"} onClick={() => update({ position: "left" })}>Bottom left</Chip>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium">Accent colour</span>
            <div className="flex flex-wrap items-center gap-2">
              {swatches.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use ${c}`}
                  aria-pressed={accent.toLowerCase() === c.toLowerCase()}
                  onClick={() => update({ accentColor: c })}
                  className={cn("size-9 cursor-pointer rounded-full border-2", accent.toLowerCase() === c.toLowerCase() ? "border-text" : "border-transparent")}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                aria-label="Custom colour"
                value={accent}
                onChange={(e) => update({ accentColor: e.target.value })}
                className="size-9 cursor-pointer rounded-full border border-line bg-transparent p-0.5"
              />
              {s.accentColor && (
                <Button variant="outline" size="sm" onClick={() => update({ accentColor: "" })}>Use brand colour</Button>
              )}
            </div>
            {errors.accentColor && <p className="text-[13px] text-danger">{errors.accentColor}</p>}
          </div>

          <Field
            label="Allowed websites"
            hint="Only these sites can show your chat. Leave empty to allow any site. Subdomains are included."
            error={errors.allowedDomains || undefined}
          >
            <Input
              value={domainInput}
              placeholder="mysite.com, then press Enter"
              onChange={(e) => setDomainInput(e.target.value)}
              onKeyDown={onDomainKey}
              onBlur={addDomain}
            />
          </Field>
          {s.allowedDomains.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Allowed websites">
              {s.allowedDomains.map((d) => (
                <li key={d} className="glass inline-flex items-center gap-1.5 rounded-full py-1.5 pr-1.5 pl-4 text-[14px]">
                  {d}
                  <button type="button" aria-label={`Remove ${d}`} onClick={() => update({ allowedDomains: s.allowedDomains.filter((x) => x !== d) })} className="flex size-7 cursor-pointer items-center justify-center rounded-full hover:bg-soft">
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

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={pending || !dirty}>{pending ? "Saving…" : "Save"}</Button>
            {errors.form && <span className="text-sm text-danger">{errors.form}</span>}
          </div>
        </GlassCard>

        <GlassCard as="section" aria-labelledby="w-install" className="flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h2 id="w-install" className="text-lg font-semibold tracking-[-0.02em]">Add it to your website</h2>
            <p className="text-[14px] text-muted">Copy this code and paste it on your site, just before the closing &lt;/body&gt; tag.</p>
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-soft p-4 text-[13px] leading-relaxed"><code>{snippet}</code></pre>
          <div><CopyButton text={snippet} label="Copy code" /></div>
          <Accordion items={STEPS} />
        </GlassCard>

        <GlassCard as="section" aria-labelledby="w-usage" className="flex flex-col gap-3 p-5 sm:p-6">
          <h2 id="w-usage" className="text-lg font-semibold tracking-[-0.02em]">Chat replies this month</h2>
          <Meter value={pct} max={usage.limit} label="AI replies used" showValue />
          <p className="text-[13px] text-muted">When you reach the limit the chat keeps collecting visitors&rsquo; contact details, without AI answers.</p>
        </GlassCard>
      </div>

      <GlassCard as="aside" aria-labelledby="w-preview" className="flex h-fit flex-col gap-3 p-4 lg:sticky lg:top-6">
        <div className="flex items-center justify-between gap-2 px-1">
          <h2 id="w-preview" className="text-lg font-semibold tracking-[-0.02em]">Live preview</h2>
          <a href={`/widget/${widgetKey}?mode=page`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
            Open <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </div>
        <iframe key={previewKey} src={previewSrc} title="Chat preview" className="h-[560px] w-full overflow-hidden rounded-2xl border border-line bg-white" />
        <p className="px-1 text-[12.5px] text-muted">This is the real chat: try it. Test replies count towards your monthly chat replies, and contact details you enter appear in Leads.</p>
      </GlassCard>
    </div>
  );
}
