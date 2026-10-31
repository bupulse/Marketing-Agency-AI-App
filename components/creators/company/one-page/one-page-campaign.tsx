"use client";

// The one-page creator campaign form (docs/CREATOR_CAMPAIGN_WIZARD.md, "One page"; lib/creators/one-page.ts). Nine
// questions in the owner's order (31 October 2026), a live summary at the bottom, and one "Create campaign": the AI
// reads the description and writes the brief, the tasks and the rest in the campaign's language, then the campaign's
// page opens. Phones first: one column, big targets, and the summary with the button stays at the bottom of the screen.

import { ImagePlus, LoaderCircle, Plus, Sparkles, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createOnePageAction, productPhotosAction } from "@/app/dashboard/creators/actions";
import { NetworkIcon } from "@/components/connections/network-icon";
import { MediaPicker } from "@/components/media/media-picker";
import { Button, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { PLATFORMS, type Platform } from "@/lib/creators/company-forms";
import type { campaignNetworks } from "@/lib/creators/networks";
import { budgetWarning, CAMPAIGN_LANGUAGES, checkOnePage, MAX_DESCRIPTION, MAX_PRODUCT_LINKS, MAX_PRODUCT_PHOTOS, minimumNote, summaryParts, withProduct, type CampaignLanguage, type OnePageField, type OnePageInput } from "@/lib/creators/one-page";
import { minRate } from "@/lib/creators/pay-floor";
import type { Network } from "@/lib/social/types";
import { MoneyInput, Question, Switch, TagInput, toggle } from "../wizard/controls";

export type OnePageOptions = {
  currency: string;
  /** The plan's creators per campaign: what Unlimited means. */
  planLimit: number;
  networks: ReturnType<typeof campaignNetworks>;
  products: { id: string; name: string; hint?: string }[];
  /** Example descriptions from the business's products and industry. */
  examples: string[];
};

/** Where the form starts: the business's language, and a product or Business info campaign it was opened from. */
export type OnePageStart = { language: CampaignLanguage; description: string; productId: string | null; productName: string; productPhotos: { id: string; url: string }[] };

type Values = Omit<OnePageInput, "ratePerThousand" | "budget" | "maxPerCreator"> & { ratePerThousand: number | null; budget: number | null; maxPerCreator: number | null; fromProduct: string[] };

const NETWORK_HINT: Record<Platform, string> = { instagram: "A professional account", facebook: "A Facebook Page", tiktok: "Short videos" };

export function OnePageCampaign({ options: o, start }: { options: OnePageOptions; start: OnePageStart }) {
  const router = useRouter();
  const { toast } = useToast();
  const [v, setV] = useState<Values>({
    language: start.language,
    description: start.description,
    currency: o.currency,
    ratePerThousand: null,
    budget: null,
    maxPerCreator: null,
    unlimitedCreators: false,
    maxCreators: null,
    platforms: [],
    coverAssetId: null,
    productId: start.productId,
    productName: start.productName,
    productLinks: [],
    productPhotoIds: start.productPhotos.map((p) => p.id),
    fromProduct: start.productPhotos.map((p) => p.id),
  });
  /** Signed links of the pictures on screen (cover and product), by Photos id. */
  const [urls, setUrls] = useState<Record<string, string>>(() => Object.fromEntries(start.productPhotos.map((p) => [p.id, p.url])));
  const [picking, setPicking] = useState<null | "cover" | "product">(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ error: string; field: OnePageField | null } | null>(null);

  const set = (patch: Partial<Values>) => {
    setProblem(null);
    setV((cur) => ({ ...cur, ...patch }));
  };
  const errorOf = (field: OnePageField) => (problem?.field === field ? problem.error : null);
  const floor = minRate(o.currency);
  const lowRate = v.ratePerThousand !== null && v.ratePerThousand > 0 && v.ratePerThousand < floor;
  const money = { budget: v.budget, maxPerCreator: v.maxPerCreator, maxCreators: v.maxCreators, unlimitedCreators: v.unlimitedCreators, planLimit: o.planLimit, currency: o.currency };
  const warning = budgetWarning(money);
  const summary = summaryParts({ ...money, ratePerThousand: v.ratePerThousand });
  const album = v.productId ? `product:${v.productId}` : undefined;

  async function pickProduct(id: string) {
    const product = o.products.find((p) => p.id === id) ?? null;
    if (!product) return set(withProduct(v, null));
    // The name fills in at once; the product's photos follow when they are read.
    set(withProduct(v, product, []));
    setLoadingPhotos(true);
    const r = await productPhotosAction(product.id);
    setLoadingPhotos(false);
    if (!r.ok) return toast(r.error, "error");
    setUrls((cur) => ({ ...cur, ...Object.fromEntries(r.photos.map((p) => [p.id, p.url])) }));
    setV((cur) => (cur.productId === product.id ? { ...cur, ...withProduct(cur, product, r.photos.map((p) => p.id)) } : cur));
  }

  async function submit() {
    const { fromProduct: _fromProduct, ...input } = v;
    void _fromProduct;
    const checked = checkOnePage({ ...input, maxCreators: v.unlimitedCreators ? null : v.maxCreators });
    if (!checked.ok) {
      setProblem({ error: checked.error, field: checked.field });
      if (checked.field) document.getElementById(`op-${checked.field}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    const r = await createOnePageAction(checked.data).catch(() => ({ ok: false as const, error: "We could not reach BuPulse. Check your connection and try again." }));
    if (!r.ok) {
      setBusy(false);
      setProblem({ error: r.error, field: null });
      return;
    }
    toast(r.ai ? "Campaign made. The AI wrote the brief and tasks: check them, then go live." : "Campaign made from a ready template. Check the brief and tasks, then go live.", "success");
    router.push(`/dashboard/creators/${r.id}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-4">
      <header className="flex flex-col gap-1 px-1">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">New creator campaign</h1>
        <p className="text-[15px] text-muted">One page. Creators post about you on their own accounts, and you pay for the views. You can change everything after.</p>
      </header>

      <GlassCard className="flex flex-col gap-8 p-5 sm:p-6">
        <Section n={1} field="language" label="Language of the campaign" hint="Creators read the campaign in this language, and the AI writes in it." error={errorOf("language")}>
          <div role="radiogroup" aria-label="Language of the campaign" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CAMPAIGN_LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                role="radio"
                aria-checked={v.language === l.code}
                onClick={() => set({ language: l.code })}
                className={cn("flex min-h-12 cursor-pointer flex-col items-start justify-center rounded-2xl border px-3.5 py-2 text-left", v.language === l.code ? "border-pulse-blue bg-ok-bg/60 shadow-ring" : "border-line bg-glass hover:bg-soft")}
              >
                <span className="text-[15px] font-semibold">{l.label}</span>
                {l.native !== l.label && <span className="text-[12px] text-muted">{l.native}</span>}
              </button>
            ))}
          </div>
        </Section>

        <Section n={2} field="description" label="Describe the campaign and the tasks" error={errorOf("description")}>
          <p className="flex items-start gap-2 rounded-2xl bg-new-bg px-3.5 py-2.5 text-[14px] text-new">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>The AI reads this to understand the tasks. From it, it writes the brief, the daily or weekly tasks, the hashtags to check and the rules. You can change them after.</span>
          </p>
          <Textarea
            aria-label="Description of the campaign and the tasks"
            rows={6}
            maxLength={MAX_DESCRIPTION}
            value={v.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder={`For example: ${o.examples[0] ?? "Film yourself trying our new juice"}. Post one video every week for a month. Use #OurHashtag and tag our account.`}
            className="min-h-36 text-[16px]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2" aria-label="Examples">
              {!v.description.trim() &&
                o.examples.slice(0, 2).map((ex) => (
                  <button key={ex} type="button" onClick={() => set({ description: ex })} className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-dashed border-line px-3.5 text-left text-[14px] text-muted hover:bg-soft hover:text-text">
                    {ex}
                  </button>
                ))}
            </div>
            <span className="ml-auto text-[12px] text-muted tabular-nums">
              {v.description.length.toLocaleString("en-US")} / {MAX_DESCRIPTION.toLocaleString("en-US")}
            </span>
          </div>
        </Section>

        <Section n={3} field="ratePerThousand" label={`Pay per 1,000 views (${o.currency})`} error={errorOf("ratePerThousand") ?? (lowRate ? minimumNote(o.currency) : null)}>
          <MoneyInput label="Pay per 1,000 views" currency={o.currency} value={v.ratePerThousand} onChange={(ratePerThousand) => set({ ratePerThousand })} placeholder={floor.toLocaleString("en-US")} invalid={lowRate || Boolean(errorOf("ratePerThousand"))} suffix="per 1,000 views" />
          {!lowRate && !errorOf("ratePerThousand") && <p className="text-[13px] text-muted">{minimumNote(o.currency)}</p>}
        </Section>

        <Section n={4} field="budget" label={`Campaign budget (${o.currency})`} hint="The most you pay all creators together, for the whole campaign (30 days)." error={errorOf("budget")}>
          <MoneyInput label="Campaign budget" currency={o.currency} value={v.budget} onChange={(budget) => set({ budget })} placeholder="500,000" invalid={Boolean(errorOf("budget"))} />
        </Section>

        <Section n={5} field="maxPerCreator" label={`Maximum payout per creator (${o.currency})`} hint="The most one creator can earn in this campaign." error={errorOf("maxPerCreator")}>
          <MoneyInput label="Maximum payout per creator" currency={o.currency} value={v.maxPerCreator} onChange={(maxPerCreator) => set({ maxPerCreator })} placeholder="50,000" invalid={Boolean(errorOf("maxPerCreator"))} />
        </Section>

        <Section n={6} field="maxCreators" label="Number of creators who can join" error={errorOf("maxCreators")}>
          <MoneyInput label="Number of creators who can join" value={v.unlimitedCreators ? null : v.maxCreators} onChange={(maxCreators) => set({ maxCreators })} placeholder={v.unlimitedCreators ? "Unlimited" : "20"} disabled={v.unlimitedCreators} invalid={Boolean(errorOf("maxCreators"))} suffix="creators" />
          <Switch checked={v.unlimitedCreators} onChange={(unlimitedCreators) => set({ unlimitedCreators })} label="Unlimited" hint={`Anyone you pick can join, up to ${o.planLimit.toLocaleString("en-US")} on your plan.`} />
          {warning && (
            <p role="status" className="flex items-start gap-2 rounded-2xl bg-amber-500/15 px-3.5 py-2.5 text-[14px] text-amber-900 dark:text-amber-200">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{warning}</span>
            </p>
          )}
        </Section>

        <Section n={7} field="platforms" label="Where creators post" hint="BuPulse counts the views on these." error={errorOf("platforms")}>
          <div role="group" aria-label="Social media platforms" className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
            {o.networks
              .filter((n) => (PLATFORMS as readonly string[]).includes(n.network))
              .map((n) => {
                const p = n.network as Platform;
                const on = v.platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    disabled={n.soon}
                    onClick={() => set({ platforms: toggle(v.platforms, p) })}
                    className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left disabled:cursor-not-allowed", on ? "border-pulse-blue bg-ok-bg/60 shadow-ring" : "border-line bg-glass hover:bg-soft", n.soon && "opacity-60 hover:bg-glass")}
                  >
                    <NetworkIcon network={p as Network} className="size-6 shrink-0" />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[15px] font-semibold">{n.label}</span>
                      <span className="text-[12px] text-muted">{n.soon ? "Coming soon" : NETWORK_HINT[p]}</span>
                    </span>
                  </button>
                );
              })}
          </div>
        </Section>

        <Section n={8} field="coverAssetId" label="Background picture" hint="At the top of your campaign page and on its card on the marketplace. Optional, but campaigns with a picture get more creators." error={errorOf("coverAssetId")}>
          {v.coverAssetId && urls[v.coverAssetId] ? (
            <div className="relative overflow-hidden rounded-2xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL */}
              <img src={urls[v.coverAssetId]} alt="The background picture" className="aspect-[16/9] w-full object-cover" />
              <div className="absolute right-2 bottom-2 flex gap-2">
                <Button size="sm" variant="outline" className="bg-surface" onClick={() => setPicking("cover")}>
                  Change
                </Button>
                <Button size="sm" variant="outline" className="bg-surface" leading={<X aria-hidden className="size-4" />} onClick={() => set({ coverAssetId: null })}>
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setPicking("cover")} className="flex aspect-[16/7] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-soft/60 text-[15px] font-semibold text-muted hover:bg-soft hover:text-text">
              <ImagePlus aria-hidden className="size-6" />
              Upload or pick a picture
            </button>
          )}
        </Section>

        <Section n={9} field="productId" label="The product" hint="What creators show. Pick it from Business info, or type its name." error={errorOf("productId") ?? errorOf("productName")}>
          {o.products.length > 0 && (
            <Select aria-label="Pick a product" value={v.productId ?? ""} onChange={(e) => void pickProduct(e.target.value)}>
              <option value="">No product picked</option>
              {o.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.hint ? ` (${p.hint})` : ""}
                </option>
              ))}
            </Select>
          )}
          <Input aria-label="Product name" value={v.productName} maxLength={120} onChange={(e) => set({ productName: e.target.value })} placeholder="Product name, e.g. Passion juice 1 litre" />

          <div id="op-productPhotoIds" className="flex flex-col gap-2">
            <p className="text-[14px] font-semibold">
              Pictures of the product <span className="font-normal text-muted">({v.productPhotoIds.length} of {MAX_PRODUCT_PHOTOS})</span>
            </p>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Pictures of the product">
              {v.productPhotoIds.map((id) => (
                <li key={id} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-soft">
                  {urls[id] && (
                    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL
                    <img src={urls[id]} alt="" className="size-full object-cover" />
                  )}
                  <button type="button" aria-label="Remove this picture" onClick={() => set({ productPhotoIds: v.productPhotoIds.filter((x) => x !== id), fromProduct: v.fromProduct.filter((x) => x !== id) })} className="absolute top-1 right-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70">
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
              {v.productPhotoIds.length < MAX_PRODUCT_PHOTOS && (
                <li>
                  <button type="button" onClick={() => setPicking("product")} className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-[13px] font-semibold text-muted hover:bg-soft hover:text-text">
                    {loadingPhotos ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : <Plus aria-hidden className="size-5" />}
                    {loadingPhotos ? "Loading" : "Add"}
                  </button>
                </li>
              )}
            </ul>
          </div>

          <div id="op-productLinks" className="flex flex-col gap-2">
            <p className="text-[14px] font-semibold">
              Links to the product <span className="font-normal text-muted">(your shop, website or a post. Optional)</span>
            </p>
            <TagInput label="Links to the product" values={v.productLinks} onChange={(productLinks) => set({ productLinks })} placeholder="Paste a link, then press Enter" max={MAX_PRODUCT_LINKS} normalize={(l) => (/^https?:\/\//i.test(l) ? l : `https://${l}`)} />
            {(errorOf("productLinks") || errorOf("productPhotoIds")) && (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {errorOf("productLinks") ?? errorOf("productPhotoIds")}
              </p>
            )}
          </div>
        </Section>
      </GlassCard>

      {/* The live summary and the one button, kept in view at the bottom of the screen. */}
      <div className="sticky bottom-0 z-20 -mx-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <GlassCard className="flex flex-col gap-3 p-4 shadow-glass sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Summary</p>
            <p aria-live="polite" className="text-[15px] font-semibold">
              {summary.length ? summary.join(" · ") : "Fill in the pay and the budget to see the summary."}
            </p>
            {warning && (
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-amber-800 dark:text-amber-200">
                <TriangleAlert aria-hidden className="size-4 shrink-0" /> The budget may run out before every creator earns the most.
              </p>
            )}
            {problem && (
              <p role="alert" className="text-[14px] font-medium text-danger">
                {problem.error}
              </p>
            )}
          </div>
          <Button size="lg" disabled={busy} onClick={submit} leading={busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Sparkles aria-hidden className="size-4" />} className="w-full shrink-0 sm:w-auto">
            {busy ? "Writing your campaign…" : "Create campaign"}
          </Button>
        </GlassCard>
        {busy && <p className="mt-2 px-1 text-center text-[13px] text-muted">The AI is writing the brief and the tasks. This can take up to a minute.</p>}
      </div>

      <MediaPicker
        open={picking !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        multiple={picking === "product"}
        max={Math.max(1, MAX_PRODUCT_PHOTOS - v.productPhotoIds.length)}
        title={picking === "cover" ? "Choose a background picture" : "Choose pictures of the product"}
        initialFolder={picking === "product" ? album : undefined}
        saveTo={album}
        onPick={(picked) => {
          setUrls((cur) => ({ ...cur, ...Object.fromEntries(picked.map((p) => [p.id, p.url])) }));
          if (picking === "cover") {
            if (picked[0]) set({ coverAssetId: picked[0].id });
          } else {
            set({ productPhotoIds: [...new Set([...v.productPhotoIds, ...picked.map((p) => p.id)])].slice(0, MAX_PRODUCT_PHOTOS) });
          }
          setPicking(null);
        }}
      />
    </div>
  );
}

/** One question of the form: its number, label and line under it, the control, and the problem with it. */
function Section({ n, field, label, hint, error, children }: { n: number; field: OnePageField; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div id={`op-${field}`} className="scroll-mt-24">
      <Question
        id={`op-${field}-label`}
        label={`${n}. ${label}`}
        hint={hint}
      >
        {children}
        {error && (
          <p role="alert" className="text-[13px] font-medium text-danger">
            {error}
          </p>
        )}
      </Question>
    </div>
  );
}
