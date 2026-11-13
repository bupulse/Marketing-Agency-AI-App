"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Ban, BarChart3, Copy, ExternalLink, Link2, MapPin, MessageCircle, Phone, Plus, ShoppingBag, Smartphone, X } from "lucide-react";
import { saveBioSettings } from "@/app/dashboard/bio/actions";
import { ChoiceCards, MultiChips, SuggestionChips } from "@/components/app/kit/c-choice";
import { SectionTabs, TabPanel, type CTab } from "@/components/app/kit/c-steps";
import { Button, Field, GlassCard, Input, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { renderBioPage } from "@/lib/bio/page";
import type { BioDay } from "@/lib/bio/service";
import { BIO_LIMITS, BIO_LINK_LABEL, MAX_BIO_PRODUCTS, buildBioView, defaultMessage, type BioSettings, type BioSource } from "@/lib/bio/view";

const BUSINESS_INFO = "/dashboard/knowledge/locations";

type BioTab = "page" | "buttons" | "where" | "products" | "links" | "results";
const TAB_LABEL: Record<BioTab, string> = { page: "Your page", buttons: "Buttons", where: "Where and when", products: "Products", links: "Links", results: "Results" };
/** Which part of the page each field is on, to open it when the save finds a problem there. */
const FIELD_TAB: Record<string, BioTab> = { slug: "page", tagline: "page", whatsapp: "buttons", message: "buttons", phone: "buttons", location: "where", landmark: "where", products: "products", links: "links" };

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
  const [tab, setTab] = useState<BioTab>("page");
  const errorTab = (Object.keys(errors).map((k) => FIELD_TAB[k]).find(Boolean) ?? null) as BioTab | null;

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
        // Open the part of the page with the first problem.
        const first = Object.keys(result.errors).map((k) => FIELD_TAB[k]).find(Boolean);
        if (first) setTab(first);
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

  const saveBar = (
    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button onClick={save} disabled={pending || readOnly || (!dirty && live.saved)}>{pending ? "Saving…" : "Save"}</Button>
      <span className="text-[13px] text-muted">{dirty ? "You have changes to save." : live.saved ? "Everything is saved." : "Save once to make your page."}</span>
      {errors.form && <span role="alert" className="text-sm text-danger">{errors.form}</span>}
      {Object.keys(errors).some((k) => k !== "form") && <span role="alert" className="text-sm text-danger">Check the highlighted fields{errorTab && errorTab !== tab ? ` on “${TAB_LABEL[errorTab]}”` : ""}.</span>}
    </div>
  );
  const tabs: CTab<BioTab>[] = [
    { id: "page", label: "Your page", hint: s.enabled ? "On" : "Off", icon: Smartphone },
    { id: "buttons", label: "Buttons", hint: [s.whatsapp && "WhatsApp", s.phone && "Call"].filter(Boolean).join(" + ") || "None yet", icon: MessageCircle },
    { id: "where", label: "Where and when", hint: s.location ? "Location shown" : "Not shown", icon: MapPin },
    { id: "products", label: "Products", hint: `${chosen.length} of ${MAX_BIO_PRODUCTS}`, icon: ShoppingBag },
    ...(source.links.length > 0 ? [{ id: "links" as const, label: "Links", hint: `${s.links.length} shown`, icon: Link2 }] : []),
    { id: "results", label: "Results", hint: `${week.views} visits this week`, icon: BarChart3 },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-4">
        {readOnly && (
          <p role="status" className="rounded-2xl bg-soft p-4 text-[14px]">
            <strong>Your page is offline.</strong> Your account is read-only right now, so visitors see “This page is not available”. <Link href="/dashboard/billing" className="underline">Open Billing</Link> to switch it back on.
          </p>
        )}

        <SectionTabs label="Link in bio" idPrefix="bio" tabs={tabs} current={tab} onChange={setTab} />

        {tab === "page" && (
          <TabPanel
            idPrefix="bio"
            current={tab}
            title="Your page"
            hint="Nothing is public until you switch it on and save."
            action={
              <label className="flex cursor-pointer items-center gap-3 text-[15px] font-medium">
                {s.enabled ? "On" : "Off"}
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  aria-label="Link in bio page"
                  disabled={readOnly}
                  onClick={() => update({ enabled: !s.enabled })}
                  className={cn("relative h-8 w-14 cursor-pointer rounded-full transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60", s.enabled ? "bg-brand-gradient" : "bg-line")}
                >
                  <span className={cn("absolute top-1 size-6 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none", s.enabled ? "left-7" : "left-1")} />
                </button>
              </label>
            }
          >
            {live.saved && live.enabled && !readOnly && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-pulse-blue/[0.06] p-3 dark:bg-pulse-blue/15">
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{link.replace(/^https?:\/\//, "")}</span>
                <Button size="sm" onClick={copy} leading={<Copy aria-hidden className="size-4" />}>Copy link</Button>
                <a href={link} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center gap-1 px-2 text-[14px] text-muted hover:text-text">
                  Open <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </div>
            )}

            <Field label="Your page address" hint={live.saved ? "If you change it, links you already shared stop working." : "Small letters, numbers and dashes. You can change it later."} error={errors.slug}>
              <div className="flex items-center gap-1">
                <span className="shrink-0 text-[15px] text-muted">{host}/b/</span>
                <Input value={s.slug} maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => update({ slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} />
              </div>
            </Field>

            <Field label="Line under your name" hint={source.defaultTagline ? "Tap the idea below, or write your own." : "One short sentence: what you sell and where."} error={errors.tagline}>
              <Input value={s.tagline} maxLength={BIO_LIMITS.tagline} placeholder={source.defaultTagline || "Shoes and bags in Kimironko, delivery in Kigali"} onChange={(e) => update({ tagline: e.target.value })} />
            </Field>
            {source.defaultTagline && s.tagline && s.tagline !== source.defaultTagline && <SuggestionChips label="Line ideas" items={[source.defaultTagline]} onPick={() => update({ tagline: "" })} className="-mt-2" />}
            {saveBar}
          </TabPanel>
        )}

        {tab === "buttons" && (
          <TabPanel
            idPrefix="bio"
            current={tab}
            title="Buttons"
            hint={
              <>
                The numbers come from your <Link href={BUSINESS_INFO} className="underline">locations, hours and contacts</Link>. Pick the ones to show.
              </>
            }
          >
            {source.whatsappNumbers.length === 0 ? (
              <p role="status" className="rounded-2xl bg-soft p-3 text-[14px]">
                <strong>No WhatsApp number yet.</strong> <Link href={BUSINESS_INFO} className="underline">Add your WhatsApp number</Link> to get the big WhatsApp button: it is what brings the messages.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="text-[14px] font-medium">WhatsApp button</span>
                <ChoiceCards
                  label="WhatsApp button"
                  value={s.whatsapp ?? ""}
                  onChange={(v) => update({ whatsapp: v || null })}
                  options={[...source.whatsappNumbers.map((n) => ({ value: n.value, label: n.display, hint: "The big green button", icon: MessageCircle })), { value: "", label: "No WhatsApp button", icon: Ban }]}
                />
                {errors.whatsapp && <p className="text-[13px] text-danger">{errors.whatsapp}</p>}
              </div>
            )}
            {s.whatsapp && (
              <>
                <Field label="First message" hint="What your customer's WhatsApp starts with. Tap the idea, or write your own." error={errors.message}>
                  <Input value={s.message} maxLength={BIO_LIMITS.message} placeholder={defaultMessage("Instagram")} onChange={(e) => update({ message: e.target.value })} />
                </Field>
                {s.message && <SuggestionChips label="Message ideas" items={[defaultMessage("Instagram")]} onPick={() => update({ message: "" })} className="-mt-2" />}
              </>
            )}
            <div className="flex flex-col gap-2">
              <span className="text-[14px] font-medium">Call button</span>
              <ChoiceCards
                label="Call button"
                value={s.phone ?? ""}
                onChange={(v) => update({ phone: v || null })}
                options={[...source.phoneNumbers.map((n) => ({ value: n.value, label: n.display, hint: "Opens the phone to call you", icon: Phone })), { value: "", label: "No call button", icon: Ban }]}
              />
              {errors.phone && <p className="text-[13px] text-danger">{errors.phone}</p>}
            </div>
            {saveBar}
          </TabPanel>
        )}

        {tab === "where" && (
          <TabPanel idPrefix="bio" current={tab} title="Where and when" hint="Help people find you and know when you are open.">
            {source.locations.length === 0 ? (
              <p className="text-[14px] text-muted">
                No address yet. <Link href={BUSINESS_INFO} className="underline">Add your location</Link> to show it with a map link.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <span className="text-[14px] font-medium">Location</span>
                  <ChoiceCards
                    label="Location"
                    columns={1}
                    value={s.location ?? ""}
                    onChange={(v) => update({ location: v || null })}
                    options={[...source.locations.map((l) => ({ value: l.address, label: l.label, hint: l.text, icon: MapPin })), { value: "", label: "Do not show a location", icon: Ban }]}
                  />
                  {errors.location && <p className="text-[13px] text-danger">{errors.location}</p>}
                </div>
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
            {saveBar}
          </TabPanel>
        )}

        {tab === "products" && (
          <TabPanel
            idPrefix="bio"
            current={tab}
            title="Products and prices"
            hint={
              <>
                Up to {MAX_BIO_PRODUCTS}, in the order you choose. They come from your <Link href="/dashboard/knowledge/products" className="underline">products and services</Link>.
              </>
            }
          >
            {source.products.length === 0 && <p className="text-[14px] text-muted">No active products yet. Add them in the Knowledge base, then pick them here.</p>}
            {chosen.length > 0 && (
              <ol className="flex flex-col gap-2" aria-label="Products on your page">
                {chosen.map((id, i) => {
                  const p = products.get(id)!;
                  return (
                    <li key={id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-2 pr-1 dark:bg-white/[0.03]">
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
              <div className="flex flex-col gap-2">
                <span className="text-[14px] font-medium">Tap to add</span>
                <ul className="kit-rise grid grid-cols-1 gap-2 min-[420px]:grid-cols-2" aria-label="Products you can add">
                  {addable.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => update({ productIds: [...chosen, p.id] })}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-line p-2.5 text-left transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-pulse-blue/50 motion-reduce:transform-none motion-reduce:transition-none"
                      >
                        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-soft text-muted">
                          <Plus className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                          <span className="block truncate text-[12.5px] text-muted">{p.price}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {errors.products && <p className="text-[13px] text-danger">{errors.products}</p>}
            {saveBar}
          </TabPanel>
        )}

        {tab === "links" && source.links.length > 0 && (
          <TabPanel idPrefix="bio" current={tab} title="Links" hint="Your other pages, shown as small buttons. Tap to show or hide each one.">
            <MultiChips
              label="Links on your page"
              values={s.links}
              onChange={(links) => update({ links })}
              options={source.links.map((l) => ({ value: l.type, label: `${BIO_LINK_LABEL[l.type]} (${l.display})` }))}
            />
            {saveBar}
          </TabPanel>
        )}

        {tab === "results" && (
          <TabPanel idPrefix="bio" current={tab} title="What your page brought" hint="Each WhatsApp tap opens a chat with you. Your own visits from this screen are not counted.">
            <dl className="kit-rise grid grid-cols-3 gap-2 sm:gap-3">
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
          </TabPanel>
        )}
      </div>

      <GlassCard as="aside" aria-labelledby="bio-preview" className="flex h-fit flex-col gap-3 p-4 lg:sticky lg:top-6">
        <h2 id="bio-preview" className="px-1 text-lg font-semibold tracking-[-0.02em]">Live preview</h2>
        <iframe srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" title="Preview of your page" className="h-[480px] w-full overflow-hidden rounded-2xl border border-line bg-white lg:h-[640px]" />
        <p className="px-1 text-[12.5px] text-muted">{dirty ? "Showing your changes. Save to put them on your page." : "This is how your page looks on a phone."}</p>
      </GlassCard>
    </div>
  );
}
