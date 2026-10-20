"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Copy, ExternalLink, X } from "lucide-react";
import { saveBioSettings } from "@/app/dashboard/bio/actions";
import { Button, Field, GlassCard, Input, Select, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { renderBioPage } from "@/lib/bio/page";
import type { BioDay } from "@/lib/bio/service";
import { BIO_LIMITS, BIO_LINK_LABEL, MAX_BIO_PRODUCTS, buildBioView, defaultMessage, type BioSettings, type BioSource } from "@/lib/bio/view";

const BUSINESS_INFO = "/dashboard/knowledge/locations";

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
      <input type="checkbox" className="size-5 accent-[var(--color-pulse-violet,#6d4aff)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function sum(days: BioDay[], n: number) {
  return days.slice(0, n).reduce((t, d) => ({ views: t.views + d.views, whatsapp: t.whatsapp + d.whatsapp, calls: t.calls + d.calls }), { views: 0, whatsapp: 0, calls: 0 });
}

export function BioSettingsForm({
  initial,
  saved,
  source,
  days,
  baseUrl,
  siteUrl,
  readOnly,
}: {
  initial: BioSettings;
  /** False until the first save: the page does not exist yet, so there is no link to copy. */
  saved: boolean;
  source: BioSource;
  days: BioDay[];
  baseUrl: string;
  siteUrl: string;
  /** The account is read-only (demo pending, trial over...): the page is offline and cannot be changed. */
  readOnly: boolean;
}) {
  const [s, setS] = useState<BioSettings>(initial);
  const [live, setLive] = useState({ saved, enabled: initial.enabled, slug: initial.slug });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const { toast } = useToast();

  const update = (patch: Partial<BioSettings>) => {
    setS((cur) => ({ ...cur, ...patch }));
    setDirty(true);
  };

  // The preview is the real page, drawn here from what is on screen (unsaved changes included).
  const html = useMemo(() => renderBioPage({ view: buildBioView(source, s, { platform: "Instagram" }), mode: "preview", siteUrl }), [source, s, siteUrl]);
  const products = new Map(source.products.map((p) => [p.id, p]));
  const chosen = s.productIds.filter((id) => products.has(id));
  const addable = source.products.filter((p) => !chosen.includes(p.id));
  const host = baseUrl.replace(/^https?:\/\//, "");
  const link = `${baseUrl}/b/${live.slug}`;
  const week = sum(days, 7);
  const month = sum(days, days.length);

  function move(id: string, by: -1 | 1) {
    const list = [...chosen];
    const i = list.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    update({ productIds: list });
  }

  function save() {
    setErrors({});
    start(async () => {
      const result = await saveBioSettings({ ...s, productIds: chosen });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setDirty(false);
      setLive({ saved: true, enabled: s.enabled, slug: s.slug });
      toast(s.enabled ? "Saved. Your page is live." : "Saved. Your page is switched off.", "success");
      if (result.missingPhotos.length) toast(`We could not use the photo of ${result.missingPhotos.join(", ")}. It shows without a photo for now.`, "info");
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied. Paste it in your Instagram or TikTok bio.", "success");
    } catch {
      toast(`Copy this link: ${link}`, "info");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-6">
        {readOnly && (
          <p role="status" className="rounded-2xl bg-soft p-4 text-[14px]">
            <strong>Your page is offline.</strong> Your account is read-only right now, so visitors see “This page is not available”. <Link href="/dashboard/billing" className="underline">Open Billing</Link> to switch it back on.
          </p>
        )}

        <GlassCard as="section" aria-labelledby="bio-page" className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="bio-page" className="text-lg font-semibold tracking-[-0.02em]">Your page</h2>
              <p className="text-[14px] text-muted">Nothing is public until you switch it on and save.</p>
            </div>
            <label className="flex cursor-pointer items-center gap-3 text-[15px] font-medium">
              {s.enabled ? "On" : "Off"}
              <button
                type="button"
                role="switch"
                aria-checked={s.enabled}
                aria-label="Link in bio page"
                disabled={readOnly}
                onClick={() => update({ enabled: !s.enabled })}
                className={cn("relative h-7 w-12 cursor-pointer rounded-full transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60", s.enabled ? "bg-brand-gradient" : "bg-line")}
              >
                <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none", s.enabled ? "left-[22px]" : "left-0.5")} />
              </button>
            </label>
          </div>

          <Field label="Your page address" hint={live.saved ? "If you change it, links you already shared stop working." : "Small letters, numbers and dashes. You can change it later."} error={errors.slug}>
            <div className="flex items-center gap-1">
              <span className="shrink-0 text-[15px] text-muted">{host}/b/</span>
              <Input value={s.slug} maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => update({ slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} />
            </div>
          </Field>

          {live.saved && live.enabled && !readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={copy} leading={<Copy aria-hidden className="size-4" />}>Copy link</Button>
              <a href={link} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 px-2 text-[14px] text-muted hover:text-text">
                Open my page <ExternalLink aria-hidden className="size-3.5" />
              </a>
            </div>
          )}

          <Field label="Line under your name" hint={source.defaultTagline ? `Leave empty to use: “${source.defaultTagline}”` : "One short sentence: what you sell and where."} error={errors.tagline}>
            <Input value={s.tagline} maxLength={BIO_LIMITS.tagline} placeholder={source.defaultTagline || "Shoes and bags in Kimironko, delivery in Kigali"} onChange={(e) => update({ tagline: e.target.value })} />
          </Field>
        </GlassCard>

        <GlassCard as="section" aria-labelledby="bio-contact" className="flex flex-col gap-5 p-5 sm:p-6">
          <div>
            <h2 id="bio-contact" className="text-lg font-semibold tracking-[-0.02em]">Buttons</h2>
            <p className="text-[14px] text-muted">
              The numbers come from your <Link href={BUSINESS_INFO} className="underline">locations, hours and contacts</Link>. Only the ones you pick here are shown.
            </p>
          </div>
          {source.whatsappNumbers.length === 0 && (
            <p role="status" className="rounded-2xl bg-soft p-3 text-[14px]">
              <strong>No WhatsApp number yet.</strong> <Link href={BUSINESS_INFO} className="underline">Add your WhatsApp number</Link> to get the big WhatsApp button: it is what brings the messages.
            </p>
          )}
          {source.whatsappNumbers.length > 0 && (
            <Field label="WhatsApp button" error={errors.whatsapp}>
              <Select value={s.whatsapp ?? ""} onChange={(e) => update({ whatsapp: e.target.value || null })}>
                <option value="">No WhatsApp button</option>
                {source.whatsappNumbers.map((n) => (
                  <option key={n.value} value={n.value}>{n.display}</option>
                ))}
              </Select>
            </Field>
          )}
          {s.whatsapp && (
            <Field label="First message" hint={`What your customer's WhatsApp starts with. Leave empty for: “${defaultMessage("Instagram")}” (or TikTok, when they come from TikTok).`} error={errors.message}>
              <Input value={s.message} maxLength={BIO_LIMITS.message} placeholder={defaultMessage("Instagram")} onChange={(e) => update({ message: e.target.value })} />
            </Field>
          )}
          <Field label="Call button" error={errors.phone}>
            <Select value={s.phone ?? ""} onChange={(e) => update({ phone: e.target.value || null })}>
              <option value="">No call button</option>
              {source.phoneNumbers.map((n) => (
                <option key={n.value} value={n.value}>{n.display}</option>
              ))}
            </Select>
          </Field>
        </GlassCard>

        <GlassCard as="section" aria-labelledby="bio-where" className="flex flex-col gap-5 p-5 sm:p-6">
          <h2 id="bio-where" className="text-lg font-semibold tracking-[-0.02em]">Where and when</h2>
          {source.locations.length === 0 ? (
            <p className="text-[14px] text-muted">
              No address yet. <Link href={BUSINESS_INFO} className="underline">Add your location</Link> to show it with a map link.
            </p>
          ) : (
            <>
              <Field label="Location" error={errors.location}>
                <Select value={s.location ?? ""} onChange={(e) => update({ location: e.target.value || null })}>
                  <option value="">Do not show a location</option>
                  {source.locations.map((l) => (
                    <option key={l.address} value={l.address}>{`${l.label}: ${l.text}`}</option>
                  ))}
                </Select>
              </Field>
              {s.location && (
                <Field label="Landmark (optional)" hint="Helps people find you: “Opposite the bus park, next to the MTN shop”." error={errors.landmark}>
                  <Input value={s.landmark} maxLength={BIO_LIMITS.landmark} onChange={(e) => update({ landmark: e.target.value })} />
                </Field>
              )}
            </>
          )}
          {source.hours ? (
            <Toggle checked={s.showHours} onChange={(v) => update({ showHours: v })} label="Show my opening hours" />
          ) : (
            <p className="text-[14px] text-muted">
              No opening hours yet. <Link href={BUSINESS_INFO} className="underline">Add your hours</Link> to show them and whether you are open now.
            </p>
          )}
        </GlassCard>

        <GlassCard as="section" aria-labelledby="bio-products" className="flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h2 id="bio-products" className="text-lg font-semibold tracking-[-0.02em]">Products and prices</h2>
            <p className="text-[14px] text-muted">
              Up to {MAX_BIO_PRODUCTS}, in the order you choose. Names, prices and photos come from your <Link href="/dashboard/knowledge/products" className="underline">products and services</Link> (the first photo of each album).
            </p>
          </div>
          {source.products.length === 0 && <p className="text-[14px] text-muted">No active products yet. Add them in the Knowledge base, then pick them here.</p>}
          {chosen.length > 0 && (
            <ol className="flex flex-col gap-2" aria-label="Products on your page">
              {chosen.map((id, i) => {
                const p = products.get(id)!;
                return (
                  <li key={id} className="flex items-center gap-3 rounded-2xl border border-line bg-white/60 p-2 pr-1">
                    {p.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a signed Storage URL, shown as it is
                      <img src={p.photoUrl} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-soft font-semibold text-muted">{p.name[0]?.toUpperCase()}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{p.name}</span>
                      <span className="block truncate text-[13px] text-muted">{p.price}</span>
                    </span>
                    <button type="button" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(id, -1)} className="flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft disabled:cursor-default disabled:opacity-30">
                      <ArrowUp aria-hidden className="size-4" />
                    </button>
                    <button type="button" aria-label={`Move ${p.name} down`} disabled={i === chosen.length - 1} onClick={() => move(id, 1)} className="flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft disabled:cursor-default disabled:opacity-30">
                      <ArrowDown aria-hidden className="size-4" />
                    </button>
                    <button type="button" aria-label={`Remove ${p.name}`} onClick={() => update({ productIds: chosen.filter((x) => x !== id) })} className="flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft">
                      <X aria-hidden className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {addable.length > 0 && chosen.length < MAX_BIO_PRODUCTS && (
            <Field label="Add a product or service" error={errors.products}>
              <Select value="" onChange={(e) => e.target.value && update({ productIds: [...chosen, e.target.value] })}>
                <option value="">Choose…</option>
                {addable.map((p) => (
                  <option key={p.id} value={p.id}>{`${p.name} (${p.price})`}</option>
                ))}
              </Select>
            </Field>
          )}
          {errors.products && addable.length === 0 && <p className="text-[13px] text-danger">{errors.products}</p>}
        </GlassCard>

        {source.links.length > 0 && (
          <GlassCard as="section" aria-labelledby="bio-links" className="flex flex-col gap-2 p-5 sm:p-6">
            <h2 id="bio-links" className="text-lg font-semibold tracking-[-0.02em]">Links</h2>
            {source.links.map((l) => (
              <Toggle
                key={l.type}
                checked={s.links.includes(l.type)}
                onChange={(v) => update({ links: v ? [...s.links, l.type] : s.links.filter((x) => x !== l.type) })}
                label={`${BIO_LINK_LABEL[l.type]} (${l.display})`}
              />
            ))}
          </GlassCard>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={pending || readOnly || (!dirty && live.saved)}>{pending ? "Saving…" : "Save"}</Button>
          {errors.form && <span role="alert" className="text-sm text-danger">{errors.form}</span>}
          {Object.keys(errors).some((k) => k !== "form") && <span role="alert" className="text-sm text-danger">Check the highlighted fields.</span>}
        </div>

        <GlassCard as="section" aria-labelledby="bio-results" className="flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h2 id="bio-results" className="text-lg font-semibold tracking-[-0.02em]">What your page brought</h2>
            <p className="text-[14px] text-muted">Each WhatsApp tap opens a chat with you. Your own visits from this screen are not counted.</p>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            {[
              ["Visits", week.views, month.views],
              ["WhatsApp taps", week.whatsapp, month.whatsapp],
              ["Calls", week.calls, month.calls],
            ].map(([label, w, m]) => (
              <div key={label} className="rounded-2xl bg-soft p-3">
                <dt className="text-[13px] text-muted">{label}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{w}</dd>
                <dd className="text-[12.5px] text-muted">last 7 days · {m} in 30 days</dd>
              </div>
            ))}
          </dl>
          {month.views + month.whatsapp + month.calls > 0 && (
            <table className="w-full text-[14px]">
              <caption className="sr-only">Visits and taps per day, last 7 days</caption>
              <thead className="text-left text-[13px] text-muted">
                <tr><th className="py-1 font-medium">Day</th><th className="py-1 text-right font-medium">Visits</th><th className="py-1 text-right font-medium">WhatsApp</th><th className="py-1 text-right font-medium">Calls</th></tr>
              </thead>
              <tbody className="tabular-nums">
                {days.slice(0, 7).map((d) => (
                  <tr key={d.date} className="border-t border-line">
                    <td className="py-1.5">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</td>
                    <td className="py-1.5 text-right">{d.views}</td>
                    <td className="py-1.5 text-right">{d.whatsapp}</td>
                    <td className="py-1.5 text-right">{d.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </GlassCard>
      </div>

      <GlassCard as="aside" aria-labelledby="bio-preview" className="flex h-fit flex-col gap-3 p-4 lg:sticky lg:top-6">
        <h2 id="bio-preview" className="px-1 text-lg font-semibold tracking-[-0.02em]">Live preview</h2>
        <iframe srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" title="Preview of your page" className="h-[640px] w-full overflow-hidden rounded-2xl border border-line bg-white" />
        <p className="px-1 text-[12.5px] text-muted">{dirty ? "Showing your changes. Save to put them on your page." : "This is how your page looks on a phone."}</p>
      </GlassCard>
    </div>
  );
}
