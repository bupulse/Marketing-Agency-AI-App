"use client";

// The new creator campaign form (docs/CREATOR_CAMPAIGN_WIZARD.md, "One page"; lib/creators/one-page.ts). The same nine
// answers as the one-page form (owner, 31 October 2026), now asked as seven short card steps (owner, 12 November 2026:
// "use cards to choose, like multiple choice ... make pages not long"; testers found campaigns too long). Most answers
// are a tap: languages, products, networks and ready amounts are cards and chips; typing stays for the description and
// for an amount of your own. One "Create campaign" at the end: the AI reads the description and writes the brief, the
// tasks and the rest in the campaign's language, then the campaign's page opens. Each step is checked before the next.

import { Ban, ImagePlus, Infinity as InfinityIcon, Languages, LoaderCircle, Package, Plus, Sparkles, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createOnePageAction, productPhotosAction } from "@/app/dashboard/creators/actions";
import { NetworkIcon } from "@/components/connections/network-icon";
import { MediaPicker } from "@/components/media/media-picker";
import { ChoiceCards, ChoiceChips, MultiCards, SuggestionChips } from "@/components/app/kit/c-choice";
import { StepFrame, StepHead } from "@/components/app/kit/c-steps";
import { Button, Input, Textarea, useToast } from "@/components/ui";
import { formatAmount, PLATFORMS, type Platform } from "@/lib/creators/company-forms";
import type { campaignNetworks } from "@/lib/creators/networks";
import { budgetWarning, CAMPAIGN_LANGUAGES, checkOnePage, MAX_DESCRIPTION, MAX_PRODUCT_LINKS, MAX_PRODUCT_PHOTOS, minimumNote, summaryParts, withProduct, type CampaignLanguage, type OnePageField, type OnePageInput } from "@/lib/creators/one-page";
import { minRate } from "@/lib/creators/pay-floor";
import type { Network } from "@/lib/social/types";
import { MoneyInput, TagInput } from "../wizard/controls";

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

/** The steps, in order, and the answers each one asks for (a problem with an answer opens its step). */
const STEPS = [
  { id: "language", label: "Language", fields: ["language"] },
  { id: "product", label: "Product", fields: ["productId", "productName", "productLinks", "productPhotoIds"] },
  { id: "tasks", label: "Tasks", fields: ["description"] },
  { id: "where", label: "Where", fields: ["platforms"] },
  { id: "pay", label: "Pay", fields: ["ratePerThousand"] },
  { id: "budget", label: "Budget", fields: ["budget", "maxPerCreator", "maxCreators", "unlimitedCreators"] },
  { id: "picture", label: "Picture", fields: ["coverAssetId", "currency"] },
] as const satisfies readonly { id: string; label: string; fields: readonly OnePageField[] }[];
const stepOf = (field: OnePageField | null) => (field ? STEPS.findIndex((st) => (st.fields as readonly string[]).includes(field)) : -1);

/** Ready amounts to tap, from the currency's minimum pay (500 RWF for 1,000 views gives 500 / 750 / 1,000). */
function amountIdeas(floor: number) {
  return {
    rate: [floor, Math.round(floor * 1.5), floor * 2],
    budget: [floor * 400, floor * 1_000, floor * 2_000],
    perCreator: [floor * 40, floor * 100, floor * 200],
  };
}

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
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  /** "Something else" picked on the product step: the name is typed. */
  const [ownProduct, setOwnProduct] = useState(!start.productId && Boolean(start.productName));

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

  const ideas = amountIdeas(floor);
  const input = () => {
    const { fromProduct: _fromProduct, ...rest } = v;
    void _fromProduct;
    return { ...rest, maxCreators: v.unlimitedCreators ? null : v.maxCreators };
  };
  const goTo = (i: number) => {
    setStep(i);
    setReached((r) => Math.max(r, i));
  };

  /** Checks the answers up to this step (later ones count as fine for now), then moves on. */
  function next() {
    const filler = { ratePerThousand: floor, budget: floor * 1_000, maxPerCreator: floor * 100, unlimitedCreators: true, maxCreators: null, platforms: ["instagram"], description: "A campaign description long enough to pass.", coverAssetId: null };
    const later = STEPS.slice(step + 1).flatMap((st) => st.fields as readonly string[]);
    const probe = { ...input(), ...Object.fromEntries(Object.entries(filler).filter(([k]) => later.includes(k))) };
    const checked = checkOnePage(probe);
    if (!checked.ok && stepOf(checked.field) <= step) {
      setProblem({ error: checked.error, field: checked.field });
      if (stepOf(checked.field) >= 0) setStep(stepOf(checked.field));
      return;
    }
    setProblem(null);
    goTo(step + 1);
  }

  async function submit() {
    const checked = checkOnePage(input());
    if (!checked.ok) {
      setProblem({ error: checked.error, field: checked.field });
      if (stepOf(checked.field) >= 0) setStep(stepOf(checked.field));
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

  const last = step === STEPS.length - 1;
  const here = STEPS[step].id;
  const fieldError = (...fields: OnePageField[]) => {
    const e = fields.map(errorOf).find(Boolean);
    return e ? (
      <p role="alert" className="flex items-start gap-2 rounded-2xl bg-danger-bg px-3.5 py-2.5 text-[14px] font-medium text-danger">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {e}
      </p>
    ) : null;
  };
  const amountChips = (label: string, values: number[], current: number | null, pick: (n: number) => void) => (
    <ChoiceChips label={label} wrap value={current !== null && values.includes(current) ? String(current) : null} onChange={(x) => pick(Number(x))} options={values.map((n) => ({ value: String(n), label: formatAmount(n, o.currency) }))} />
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-4">
      <header className="flex flex-col gap-1 px-1">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] sm:text-[30px]">New creator campaign</h1>
        <p className="text-[15px] text-muted">Seven quick steps, most of them a tap. Creators post about you on their own accounts, and you pay for the views. You can change everything after.</p>
      </header>

      <StepFrame
        steps={STEPS}
        index={step}
        reached={reached}
        onIndex={(i) => {
          setProblem(null);
          setStep(i);
        }}
        next={
          last
            ? { label: "Create campaign", onClick: () => void submit(), busy, busyLabel: "Writing your campaign…", icon: <Sparkles aria-hidden className="size-4" /> }
            : { onClick: next }
        }
        aside={
          <>
            {summary.length > 0 && (
              <p aria-live="polite" className="rounded-2xl bg-surface/90 px-4 py-2 text-[13.5px] font-semibold shadow-[0_10px_30px_-24px_rgba(17,24,39,0.6)] backdrop-blur-md dark:bg-[#1b1b22]/90">
                {summary.join(" · ")}
              </p>
            )}
            {problem && problem.field === null && (
              <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-2 text-[14px] font-medium text-danger">
                {problem.error}
              </p>
            )}
            {busy && <p className="px-1 text-center text-[13px] text-muted">The AI is writing the brief and the tasks. This can take up to a minute.</p>}
          </>
        }
      >
        {here === "language" && (
          <>
            <StepHead kicker="Step 1" title="Which language should creators read?" hint="The campaign page is shown in it, and the AI writes the brief in it." />
            <ChoiceCards
              label="Language of the campaign"
              value={v.language}
              onChange={(language) => set({ language })}
              options={CAMPAIGN_LANGUAGES.map((l) => ({ value: l.code, label: l.label, hint: l.native !== l.label ? l.native : undefined, icon: Languages }))}
            />
            {fieldError("language")}
          </>
        )}

        {here === "product" && (
          <>
            <StepHead kicker="Step 2" title="What should creators show?" hint="Pick a product from Business info, or name something else." />
            <ChoiceCards
              label="The product"
              columns={2}
              value={ownProduct ? "__own" : (v.productId ?? (o.products.length ? "__none" : "__own"))}
              onChange={(id) => {
                if (id === "__own") {
                  setOwnProduct(true);
                  if (v.productId) set(withProduct(v, null));
                } else if (id === "__none") {
                  setOwnProduct(false);
                  set(withProduct(v, null));
                } else {
                  setOwnProduct(false);
                  void pickProduct(id);
                }
              }}
              options={[
                ...o.products.slice(0, 12).map((p) => ({ value: p.id, label: p.name, hint: p.hint, icon: Package })),
                { value: "__own", label: "Something else", hint: "Type its name", icon: Plus },
                ...(o.products.length ? [{ value: "__none", label: "No product", hint: "The whole business", icon: Ban }] : []),
              ]}
            />
            {(ownProduct || !o.products.length) && (
              <Input aria-label="Product name" autoFocus={ownProduct} value={v.productName} maxLength={120} onChange={(e) => set({ productName: e.target.value })} placeholder="Product name, e.g. Passion juice 1 litre" />
            )}
            {(v.productId || ownProduct || v.productPhotoIds.length > 0) && (
              <div id="op-productPhotoIds" className="flex flex-col gap-2">
                <p className="text-[14px] font-semibold">
                  Pictures of it <span className="font-normal text-muted">({v.productPhotoIds.length} of {MAX_PRODUCT_PHOTOS}, optional)</span>
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
            )}
            <details className="group rounded-2xl border border-line px-4 py-3" open={v.productLinks.length > 0 || Boolean(errorOf("productLinks"))}>
              <summary className="cursor-pointer text-[14px] font-semibold">Add a link to it (optional)</summary>
              <div id="op-productLinks" className="flex flex-col gap-2 pt-3">
                <p className="text-[13px] text-muted">Your shop, website or a post about it.</p>
                <TagInput label="Links to the product" values={v.productLinks} onChange={(productLinks) => set({ productLinks })} placeholder="Paste a link, then press Enter" max={MAX_PRODUCT_LINKS} normalize={(l) => (/^https?:\/\//i.test(l) ? l : `https://${l}`)} />
              </div>
            </details>
            {fieldError("productId", "productName", "productLinks", "productPhotoIds")}
          </>
        )}

        {here === "tasks" && (
          <>
            <StepHead kicker="Step 3" title="What should creators post?" hint="A few sentences. The AI turns them into the brief, the tasks, the hashtags and the rules." />
            {o.examples.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] font-semibold text-muted">Tap an idea to start from it</p>
                <SuggestionChips label="Ideas" items={o.examples.slice(0, 3)} onPick={(ex) => set({ description: ex })} />
              </div>
            )}
            <Textarea
              aria-label="Description of the campaign and the tasks"
              rows={5}
              maxLength={MAX_DESCRIPTION}
              value={v.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder={`For example: ${o.examples[0] ?? "Film yourself trying our new juice"}. Post one video every week for a month. Use #OurHashtag and tag our account.`}
              className="min-h-32 text-[16px]"
            />
            <p className="flex items-start gap-2 text-[13px] text-muted">
              <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-violet" />
              <span>
                Say how often to post and what to show. {v.description.length.toLocaleString("en-US")} / {MAX_DESCRIPTION.toLocaleString("en-US")}
              </span>
            </p>
            {fieldError("description")}
          </>
        )}

        {here === "where" && (
          <>
            <StepHead kicker="Step 4" title="Where do creators post?" hint="Pick one or more. BuPulse counts the views there." />
            <MultiCards
              label="Social media platforms"
              columns={1}
              values={v.platforms}
              onChange={(platforms) => set({ platforms })}
              options={o.networks
                .filter((n) => (PLATFORMS as readonly string[]).includes(n.network))
                .map((n) => ({ value: n.network as Platform, label: n.label, hint: n.soon ? "Coming soon" : NETWORK_HINT[n.network as Platform], icon: <NetworkIcon network={n.network as Network} className="size-6" />, disabled: n.soon }))}
            />
            {fieldError("platforms")}
          </>
        )}

        {here === "pay" && (
          <>
            <StepHead kicker="Step 5" title="How much for 1,000 views?" hint={`What a creator earns each time their posts reach 1,000 views. ${minimumNote(o.currency)}`} />
            {amountChips("Pay per 1,000 views", ideas.rate, v.ratePerThousand, (ratePerThousand) => set({ ratePerThousand }))}
            <MoneyInput label="Pay per 1,000 views" currency={o.currency} value={v.ratePerThousand} onChange={(ratePerThousand) => set({ ratePerThousand })} placeholder="Or type your own" invalid={lowRate || Boolean(errorOf("ratePerThousand"))} suffix="per 1,000 views" />
            {fieldError("ratePerThousand") ?? (lowRate ? <p role="status" className="text-[13px] font-medium text-danger">{minimumNote(o.currency)}</p> : null)}
          </>
        )}

        {here === "budget" && (
          <>
            <StepHead kicker="Step 6" title="Your budget" hint="The most you pay, for the whole campaign (30 days)." />
            <div id="op-budget" className="flex flex-col gap-2">
              <p className="text-[14px] font-semibold">For all creators together</p>
              {amountChips("Campaign budget", ideas.budget, v.budget, (budget) => set({ budget }))}
              <MoneyInput label="Campaign budget" currency={o.currency} value={v.budget} onChange={(budget) => set({ budget })} placeholder="Or type your own" invalid={Boolean(errorOf("budget"))} />
            </div>
            <div id="op-maxPerCreator" className="flex flex-col gap-2">
              <p className="text-[14px] font-semibold">The most one creator can earn</p>
              {amountChips("Maximum payout per creator", ideas.perCreator, v.maxPerCreator, (maxPerCreator) => set({ maxPerCreator }))}
              <MoneyInput label="Maximum payout per creator" currency={o.currency} value={v.maxPerCreator} onChange={(maxPerCreator) => set({ maxPerCreator })} placeholder="Or type your own" invalid={Boolean(errorOf("maxPerCreator"))} />
            </div>
            <div id="op-maxCreators" className="flex flex-col gap-2">
              <p className="text-[14px] font-semibold">How many creators can join</p>
              <ChoiceChips
                label="Number of creators who can join"
                wrap
                value={v.unlimitedCreators ? "unlimited" : v.maxCreators !== null ? String(v.maxCreators) : null}
                onChange={(x) => (x === "unlimited" ? set({ unlimitedCreators: true }) : set({ unlimitedCreators: false, maxCreators: Number(x) }))}
                options={[
                  ...[5, 10, 20, 50].filter((n) => n <= o.planLimit).map((n) => ({ value: String(n), label: `${n} creators` })),
                  { value: "unlimited", label: "Unlimited", icon: InfinityIcon },
                ]}
              />
              {v.unlimitedCreators ? (
                <p className="text-[13px] text-muted">Anyone you pick can join, up to {o.planLimit.toLocaleString("en-US")} on your plan.</p>
              ) : (
                <MoneyInput label="Number of creators who can join" value={v.maxCreators} onChange={(maxCreators) => set({ maxCreators })} placeholder="Or type a number" invalid={Boolean(errorOf("maxCreators"))} suffix="creators" />
              )}
            </div>
            {warning && (
              <p role="status" className="flex items-start gap-2 rounded-2xl bg-amber-500/15 px-3.5 py-2.5 text-[14px] text-amber-900 dark:text-amber-200">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{warning}</span>
              </p>
            )}
            {fieldError("budget", "maxPerCreator", "maxCreators", "unlimitedCreators")}
          </>
        )}

        {here === "picture" && (
          <>
            <StepHead kicker="Last step" title="Add a picture, then create" hint="Shown at the top of your campaign page and on the marketplace. Optional, but campaigns with a picture get more creators." />
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
              <button type="button" onClick={() => setPicking("cover")} className="flex aspect-[16/7] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-soft/60 text-[15px] font-semibold text-muted transition-colors hover:bg-soft hover:text-text">
                <ImagePlus aria-hidden className="size-6" />
                Upload or pick a picture
              </button>
            )}
            {fieldError("coverAssetId", "currency")}
            <dl className="grid grid-cols-1 gap-2 rounded-2xl bg-soft p-4 text-[14px] sm:grid-cols-2">
              <Summary label="Language" value={CAMPAIGN_LANGUAGES.find((l) => l.code === v.language)?.label ?? "–"} onEdit={() => setStep(0)} />
              <Summary label="Product" value={v.productName || "The whole business"} onEdit={() => setStep(1)} />
              <Summary label="Where" value={v.platforms.map((p) => o.networks.find((n) => n.network === p)?.label ?? p).join(", ") || "–"} onEdit={() => setStep(3)} />
              <Summary label="Pay" value={v.ratePerThousand ? `${formatAmount(v.ratePerThousand, o.currency)} per 1,000 views` : "–"} onEdit={() => setStep(4)} />
            </dl>
          </>
        )}
      </StepFrame>

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

/** One answer on the last step, with a link back to change it. */
function Summary({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="flex min-w-0 flex-col">
        <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
        <dd className="m-0 truncate font-medium">{value}</dd>
      </span>
      <button type="button" onClick={onEdit} className="shrink-0 text-[13px] font-semibold text-pulse-blue hover:underline">
        Change
      </button>
    </div>
  );
}
