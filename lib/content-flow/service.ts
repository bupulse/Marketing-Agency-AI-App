// "Create today's content" (docs/CONTENT.md, content flow v3): one run makes a post per chosen network for a product,
// a campaign or General, for the business's local day. Captions first (one text generation per post, from the
// Knowledge base and the day's angle, or the owner's caption adapted), then the visuals (Gallery photos and videos
// first, then AI people photos or free designs, as the owner chose), then the posts as drafts, which go through
// approval or auto-approval like every Studio post.
import "server-only";
import { prisma } from "@/lib/db";
import { getTextProvider } from "@/lib/ai";
import { withLedger } from "@/lib/ai/ledger";
import type { BrandContext } from "@/lib/ai/marketing";
import type { TokenUsage } from "@/lib/ai/types";
import { readKnowledge } from "@/lib/brand/schemas";
import { knowledgeFacts } from "@/lib/business-info/facts";
import { autoSchedule } from "@/lib/content-board/auto";
import type { ContentScope } from "@/lib/content-board/filters";
import { logError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { industryContext } from "@/lib/industry-context";
import { profileContext } from "@/lib/knowledge/context";
import { readMarketingProfile } from "@/lib/knowledge/interview";
import { KnowledgeError, writingSubject, type WritingSubject } from "@/lib/knowledge/service";
import { writerKnowledge } from "@/lib/knowledge/writer-context";
import { accountUsable } from "@/lib/publishing/service";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { NETWORKS, type Network } from "@/lib/social/types";
import { configuredModel } from "@/lib/studio/service";
import { consumeUsage, getUsageSummary, refundUsage, UsageLimitError } from "@/lib/usage";
import { aiPhotosAvailable, planVisuals, videoAvailable, type Owner } from "@/lib/visuals/service";
import { pickAngle, subjectKeyOf, type AngleChoice, type AngleFacts, type AngleHistory } from "./angles";
import { runCost, type DayMode, type DesignChoice } from "./cost";
import { dateDay, dayDate, todayIn } from "./day";
import { assignMedia, isDrawable, mediaLines, ownMediaFor, type GalleryItem, type PostMedia } from "./media";
import { fitToNetwork, languageLine, languageMixOf, NETWORK_STYLE } from "./networks";
import { adaptOwnPost, writeDayPost, type DaySubject } from "./writer";

/** A problem the owner can read and act on. */
export class DayRunError extends KnowledgeError {}

export const MAX_BRIEF = 1000;
export const MAX_OWN_CAPTION = 2200;
export const MAX_OWN_MEDIA = 10;
/** Days of history the photo rotation and the "recent posts" lines look at. */
const HISTORY_DAYS = 30;

export type DayRunInput = {
  scope: ContentScope;
  mode: DayMode;
  design: DesignChoice;
  networks: Network[];
  /** "Describe today's content". */
  brief?: string | null;
  /** "Bring my own": the caption to adapt. */
  caption?: string | null;
  /** Gallery paths the owner picked (optional when describing, required when bringing their own). */
  mediaPaths?: string[];
  /** "Bring my own": draw BuPulse designs over the photos instead of using them as they are. */
  overlays?: boolean;
};

export type DayRunResult = { day: string; runId: string; posts: number; scheduled: number; skipped: { network: Network; reason: string }[]; failed: Network[]; angle: string | null };

type Item = { type: string; title: string; price: string | null; features: string[]; context: string | null; photoPaths: string[] };

/** The subject as the writers see it; General is the business itself. */
async function subjectItem(businessId: string, scope: ContentScope, businessName: string): Promise<{ item: Item; writing: WritingSubject | null } | null> {
  if (scope.kind === "general") return { item: { type: "other", title: businessName, price: null, features: [], context: null, photoPaths: [] }, writing: null };
  const writing = await writingSubject(businessId, scope);
  if (!writing) return null;
  return { item: { type: writing.type, title: writing.title, price: writing.price ?? null, features: writing.features, context: writing.context ?? null, photoPaths: writing.photoPaths }, writing };
}

const ASSET = { path: true, name: true, mimeType: true } as const;

/** The subject's album (photos and videos, cover first); General uses the business's newest gallery items. */
export async function subjectGallery(businessId: string, scope: ContentScope): Promise<GalleryItem[]> {
  if (scope.kind === "product") return (await prisma.productPhoto.findMany({ where: { productId: scope.id, asset: { businessId } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 30, select: { asset: { select: ASSET } } })).map((r) => r.asset);
  if (scope.kind === "campaign") {
    const own = (await prisma.campaignPhoto.findMany({ where: { campaignId: scope.id, asset: { businessId } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 30, select: { asset: { select: ASSET } } })).map((r) => r.asset);
    if (own.length) return own;
    // A campaign without its own photos uses its first linked product's album (as writingSubject does).
    const first = await prisma.campaignProduct.findFirst({ where: { campaignId: scope.id }, select: { productId: true } });
    return first ? subjectGallery(businessId, { kind: "product", id: first.productId }) : [];
  }
  return prisma.mediaAsset.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 12, select: ASSET });
}

const subjectWhere = (scope: ContentScope) => (scope.kind === "product" ? { productId: scope.id } : scope.kind === "campaign" ? { campaignId: scope.id } : { productId: null, campaignId: null });

/** How often each gallery path led a picture or went out as a post lately, so the next days prefer others. */
async function recentUses(businessId: string, scope: ContentScope, since: Date): Promise<Map<string, number>> {
  const [visuals, posts] = await Promise.all([
    prisma.contentVisual.findMany({ where: { businessId, createdAt: { gte: since }, content: subjectWhere(scope) }, select: { plan: true }, take: 200 }),
    prisma.post.findMany({ where: { businessId, ...subjectWhere(scope), createdAt: { gte: since } }, select: { mediaPaths: true }, take: 300 }),
  ]);
  const uses = new Map<string, number>();
  const add = (p: unknown) => typeof p === "string" && uses.set(p, (uses.get(p) ?? 0) + 1);
  for (const v of visuals) {
    const plan = v.plan as { slides?: { photoPath?: unknown }[]; scenes?: { photoPath?: unknown }[] } | null;
    for (const s of plan?.slides ?? []) add(s.photoPath);
    for (const s of plan?.scenes ?? []) add(s.photoPath);
  }
  for (const p of posts) for (const path of p.mediaPaths) add(path);
  return uses;
}

/** The angles a subject used lately (Studio runs and Autopilot). */
export async function angleHistory(businessId: string, subjectKey: string, day: string): Promise<AngleHistory> {
  const rows = await prisma.contentAngle.findMany({ where: { businessId, subjectKey, day: { gte: dayDate(addDaysKey(day, -60)) } }, orderBy: { day: "desc" }, take: 120, select: { day: true, angle: true, hook: true, structure: true } });
  return rows.map((r) => ({ day: dateDay(r.day), angle: r.angle, hook: r.hook, structure: r.structure }));
}

function addDaysKey(day: string, n: number) {
  const d = dayDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dateDay(d);
}

export async function recordAngle(businessId: string, subjectKey: string, day: string, choice: AngleChoice, source: "studio" | "autopilot") {
  const data = { angle: choice.angle, hook: choice.hook, structure: choice.structure };
  await prisma.contentAngle.upsert({
    where: { businessId_subjectKey_day_source: { businessId, subjectKey, day: dayDate(day), source } },
    create: { businessId, subjectKey, day: dayDate(day), source, ...data },
    update: data,
  });
}

/** What the subject's facts allow for angles: a price, news (a campaign, a new product), quotable reviews, FAQs. */
export async function angleFacts(businessId: string, scope: ContentScope, item: { price: string | null }, now: Date): Promise<AngleFacts & { faqList: { question: string; answer: string }[] }> {
  const [reviews, faqList, product] = await Promise.all([
    prisma.testimonial.count({ where: { businessId, canPublish: true } }),
    prisma.knowledgeFaq.findMany({ where: { businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 20, select: { question: true, answer: true } }),
    scope.kind === "product" ? prisma.product.findFirst({ where: { id: scope.id, businessId }, select: { createdAt: true } }) : null,
  ]);
  const newProduct = !!product && now.getTime() - product.createdAt.getTime() < 30 * 24 * 60 * 60 * 1000;
  return { hasPrice: !!item.price, hasNews: scope.kind === "campaign" || newProduct, reviews, faqs: faqList.length, faqList };
}

/** The accounts a run posts to: the first usable one per network; a network without one gets a reminder post. */
async function targetsFor(businessId: string, networks: Network[]) {
  const connections = (await prisma.connection.findMany({ where: { businessId, kind: "SOCIAL" }, orderBy: { createdAt: "asc" } })).filter((c) => isNetwork(c.provider) && accountUsable(c));
  return networks.map((network) => ({ network, connection: connections.find((c) => c.provider === network) ?? null }));
}

/** The networks the dialog offers: the connected ones first, then the rest (they get a reminder to post it yourself). */
export async function networkChoices(businessId: string): Promise<{ network: Network; label: string; connected: boolean }[]> {
  const connected = new Set((await prisma.connection.findMany({ where: { businessId, kind: "SOCIAL" }, select: { provider: true, status: true, postingMode: true } })).filter(accountUsable).map((c) => c.provider));
  return [...NETWORKS].sort((a, b) => Number(connected.has(b)) - Number(connected.has(a))).map((n) => ({ network: n, label: NETWORK_STYLE[n].label, connected: connected.has(n) }));
}

/** What the dialog needs to say what a run uses. */
export async function runAllowance(owner: Owner): Promise<{ textLeft: number; imagesLeft: number; aiPhotos: boolean; videoInPlan: boolean }> {
  const [usage, aiPhotos, videoInPlan] = await Promise.all([getUsageSummary(owner.userId), aiPhotosAvailable(owner), videoAvailable(owner.businessId)]);
  return { textLeft: Math.max(0, usage.limits.text - usage.used.text), imagesLeft: Math.max(0, usage.limits.image - usage.used.image), aiPhotos, videoInPlan };
}

function cleanText(value: string | null | undefined, max: number): string {
  return (value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

/** Runs one "Create today's content". Throws DayRunError (nothing charged) when it cannot start. */
export async function runDayContent(owner: Owner, input: DayRunInput, now = new Date()): Promise<DayRunResult> {
  const { businessId, userId } = owner;
  const networks = [...new Set(input.networks)].filter((n) => (NETWORKS as readonly string[]).includes(n));
  if (networks.length === 0) throw new DayRunError("Choose at least one app.");
  const brief = cleanText(input.brief, MAX_BRIEF) || null;
  const ownCaption = cleanText(input.caption, MAX_OWN_CAPTION);
  if (input.mode === "describe" && !brief) throw new DayRunError("Describe today's content first.");
  if (input.mode === "own" && !ownCaption) throw new DayRunError("Write your caption first.");

  const business = await prisma.business.findUnique({ where: { id: businessId }, include: { industryRef: true } });
  if (!business) throw new DayRunError("We could not find your business.");
  const subject = await subjectItem(businessId, input.scope, business.name);
  if (!subject) throw new DayRunError("We could not find that product or campaign.");
  const zone = business.timezone || "UTC";
  const day = todayIn(zone, now);
  const subjectKey = subjectKeyOf(input.scope);

  // The owner's picks must be their own gallery items.
  const picked = input.mediaPaths?.length
    ? (await prisma.mediaAsset.findMany({ where: { businessId, path: { in: [...new Set(input.mediaPaths)].slice(0, MAX_OWN_MEDIA) } }, select: ASSET })).sort((a, b) => input.mediaPaths!.indexOf(a.path) - input.mediaPaths!.indexOf(b.path))
    : [];
  if (input.mode === "own" && picked.length === 0) throw new DayRunError("Choose your photos or videos from the Gallery first.");

  const allowance = await runAllowance(owner);
  const since = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

  // Which media each post uses, decided before writing so the caption can talk about it.
  let plans = new Map<Network, PostMedia>();
  const skipped: DayRunResult["skipped"] = [];
  const own = new Map<Network, Exclude<ReturnType<typeof ownMediaFor>, { skip: string }>>();
  if (input.mode === "own") {
    for (const n of networks) {
      const m = ownMediaFor(n, picked);
      if ("skip" in m) skipped.push({ network: n, reason: m.skip });
      else own.set(n, m);
    }
  } else {
    const [album, uses] = await Promise.all([subjectGallery(businessId, input.scope), recentUses(businessId, input.scope, since)]);
    // Photos the owner picked while describing come first, then the album.
    const gallery = [...picked, ...album.filter((a) => !picked.some((p) => p.path === a.path))].map((m) => ({ ...m, recentUses: picked.some((p) => p.path === m.path) ? -1 : (uses.get(m.path) ?? 0) }));
    plans = assignMedia({ networks, gallery, day, videoInPlan: allowance.videoInPlan });
  }
  const posting = input.mode === "own" ? networks.filter((n) => own.has(n)) : networks;
  if (posting.length === 0) throw new DayRunError(skipped.map((s) => s.reason).join(" ") || "Nothing could be made from that.");

  const designedCount = input.mode === "own" ? (input.overlays ? posting.filter((n) => own.get(n)!.format !== "SCRIPT" && !own.get(n)!.mediaPaths.some((p) => /\.(mp4|webm)$/i.test(p))).length : 0) : posting.filter((n) => plans.get(n)!.kind === "image").length;
  const cost = runCost({ mode: input.mode, design: input.design, posts: posting.length, designed: designedCount, aiPhotos: allowance.aiPhotos, textLeft: allowance.textLeft, imagesLeft: allowance.imagesLeft });
  if (!cost.enoughText) throw new DayRunError(`Not enough text generations left for ${posting.length} posts. ${cost.message}`);

  // The day's angle: least recently used for this subject, so consecutive days differ.
  const facts = input.mode === "own" ? null : await angleFacts(businessId, input.scope, subject.item, now);
  const choice = facts ? pickAngle({ subjectKey, day, history: await angleHistory(businessId, subjectKey, day), facts }) : null;
  if (choice) await recordAngle(businessId, subjectKey, day, choice, "studio").catch((e) => logError(e, { source: "content-flow.angle", level: "warn", businessId }));
  const faq = choice?.angle === "faq" && facts?.faqList.length ? facts.faqList[Number.parseInt(day.replace(/-/g, ""), 10) % facts.faqList.length] : null;

  const [kb, previous] = await Promise.all([
    writerKnowledge(businessId),
    prisma.generatedContent.findMany({ where: { businessId, ...subjectWhere(input.scope), createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 4, select: { caption: true } }),
  ]);
  const brand: BrandContext = {
    businessName: business.name,
    industry: business.industry,
    industryContext: industryContext(business),
    description: business.description,
    audience: business.audience,
    tone: business.tone,
    website: business.website,
    contentLanguage: business.contentLanguage,
    knowledge: knowledgeFacts(readKnowledge(business.knowledge)),
    profile: profileContext(business.profile),
    ...kb,
  };
  const mix = languageMixOf(readMarketingProfile(business.marketingProfile));
  const daySubject: DaySubject | null = input.scope.kind === "general" ? null : subject.item;
  const runId = globalThis.crypto.randomUUID();
  const configured = (process.env.AI_TEXT_PROVIDER ?? "gemini").toLowerCase();

  // Step 1: the captions, one text generation per post, in parallel.
  const written = await Promise.all(
    posting.map(async (network) => {
      const plan = plans.get(network);
      const video = input.mode !== "own" && !!plan && plan.kind !== "image" && NETWORK_STYLE[network].video === "always";
      let reservation: { periodStart: Date };
      try {
        reservation = await consumeUsage(userId, "text");
      } catch (error) {
        if (!(error instanceof UsageLimitError)) await logError(error, { source: "content-flow.reserve", businessId });
        return null;
      }
      try {
        const ledger = { userId, businessId, feature: "content" };
        const model = { provider: configured, model: configuredModel(configured) };
        const usage = (r: { provider: string; model: string; usage: TokenUsage }) => ({ provider: r.provider, model: r.model, usage: r.usage });
        if (input.mode === "own") {
          const r = await withLedger(ledger, model, () => adaptOwnPost(getTextProvider(), { brand, network, caption: ownCaption, media: mediaLines({ kind: "own", items: picked }), languageLine: null }), usage);
          return { network, caption: r.caption, hashtags: r.hashtags, headline: "", videoScript: "", provider: r.provider, model: r.model };
        }
        const r = await withLedger(
          ledger,
          model,
          () => writeDayPost(getTextProvider(), { brand, network, subject: daySubject, angle: choice!, day, languageLine: languageLine(business.contentLanguage, mix, network), media: mediaLines(plan!), video, brief, faq, previous: previous.map((p) => p.caption) }),
          usage,
        );
        return { network, caption: r.caption, hashtags: r.hashtags, headline: r.headline, videoScript: r.videoScript, provider: r.provider, model: r.model };
      } catch (error) {
        await refundUsage(userId, "text", reservation.periodStart).catch((e) => logError(e, { source: "content-flow.refund", level: "error", businessId }));
        await logError(error, { source: "content-flow.write", level: "warn", businessId });
        // The owner's own caption still goes out when the adaptation fails: held to the network's rules, uncharged.
        if (input.mode === "own") return { network, ...fitToNetwork(network, ownCaption, []), headline: "", videoScript: "", provider: "edit", model: "owner" };
        return null;
      }
    }),
  );
  const done = written.filter((w): w is NonNullable<typeof w> => w !== null);
  const failed = posting.filter((n) => !done.some((w) => w.network === n));
  if (done.length === 0) throw new DayRunError("We could not write today's content just now. You were not charged, please try again.");

  // Save one content row per post (its own visuals hang from it).
  const columns = input.scope.kind === "product" ? { productId: input.scope.id, campaignId: null } : input.scope.kind === "campaign" ? { productId: null, campaignId: input.scope.id } : { productId: null, campaignId: null };
  const contents = await Promise.all(
    done.map((w) =>
      prisma.generatedContent.create({
        data: {
          businessId,
          ...columns,
          caption: w.caption,
          hashtags: w.hashtags,
          videoScript: w.videoScript,
          adHeadlines: w.headline ? [w.headline] : [],
          language: business.contentLanguage,
          edited: input.mode === "own",
          provider: w.provider,
          model: w.model,
          forDate: dayDate(day),
          angle: choice?.angle ?? null,
          network: w.network,
          runId,
          mode: input.mode,
          brief: input.mode === "describe" ? brief : input.mode === "own" ? ownCaption : null,
          postsDraftedAt: now,
        },
        select: { id: true },
      }),
    ),
  );

  // Step 2: the visuals. One art director call per designed post; AI photos only with "AI designs", within the credits.
  const aiAllowed = input.design === "ai" && allowance.aiPhotos && input.mode !== "own";
  let aiBudget = aiAllowed ? allowance.imagesLeft : 0;
  const carouselAllowed = (n: Network) => getProvider(n).rules.formats.includes("CAROUSEL");
  const owner2: Owner = { userId, businessId, service: owner.service };
  const bits = { name: business.name, tone: business.tone, industry: business.industry, brandColors: business.brandColors };
  await Promise.all(
    done.map(async (w, i) => {
      const contentId = contents[i].id;
      const common = { owner: owner2, target: { contentId }, subjectId: input.scope.kind === "general" ? null : input.scope.id, business: bits, subjectType: subject.item.type, title: subject.item.title, price: subject.item.price, caption: w.caption, headlines: w.headline ? [w.headline] : [], videoScript: w.videoScript };
      if (input.mode === "own") {
        const m = own.get(w.network)!;
        if (!input.overlays || m.format === "SCRIPT" || m.mediaPaths.some((p) => /\.(mp4|webm)$/i.test(p))) return;
        await planVisuals({ ...common, photos: m.mediaPaths, video: false, carouselAllowed: carouselAllowed(w.network), aiAllowed: false });
        return;
      }
      const plan = plans.get(w.network)!;
      const photos = plan.photos.filter(isDrawable).map((p) => p.path);
      if (plan.kind === "image") {
        const ai = aiBudget > 0;
        if (ai) aiBudget -= 1;
        await planVisuals({ ...common, photos, video: false, carouselAllowed: carouselAllowed(w.network), aiAllowed: ai });
      } else if (plan.kind === "render-video" && w.videoScript) {
        await planVisuals({ ...common, photos, image: false, video: true, carouselAllowed: false, aiAllowed: false });
      }
    }),
  );

  // Step 3: the posts, as drafts waiting for review (or scheduled where Content -> Settings says so).
  const targets = await targetsFor(businessId, done.map((w) => w.network));
  const rows: Prisma.PostCreateManyInput[] = done.map((w, i) => {
    const target = targets.find((t) => t.network === w.network)!;
    const media = postMediaFor(input, w.network, plans.get(w.network), own.get(w.network));
    return {
      businessId,
      connectionId: target.connection?.id ?? null,
      remindOnly: target.connection === null,
      network: w.network,
      groupId: runId,
      ...columns,
      contentId: contents[i].id,
      status: "PENDING_APPROVAL",
      format: media.format,
      source: "STUDIO",
      // A video idea without the owner's video is the script to film; otherwise the caption.
      text: media.format === "SCRIPT" && media.mediaPaths.length === 0 && w.videoScript ? w.videoScript : w.caption,
      hashtags: w.hashtags,
      mediaPaths: media.mediaPaths,
    };
  });
  const created = await prisma.$transaction(rows.map((data) => prisma.post.create({ data, select: { id: true } })));
  const auto = await autoSchedule(businessId, created.map((p) => p.id), now).catch(async (e) => {
    await logError(e, { source: "content-flow.auto", level: "warn", businessId });
    return { scheduled: 0, waiting: 0 };
  });
  return { day, runId, posts: created.length, scheduled: auto.scheduled, skipped, failed, angle: choice?.angle ?? null };
}

/**
 * The post's media and format when it is drafted. Designed pictures and BuPulse's videos are filled in when they are
 * drawn (attachToContent); the owner's own photos and videos are used as they are.
 */
export function postMediaFor(input: Pick<DayRunInput, "mode" | "overlays">, network: Network, plan: PostMedia | undefined, own: { format: "POST" | "CAROUSEL" | "SCRIPT"; mediaPaths: string[] } | undefined): { format: "POST" | "CAROUSEL" | "SCRIPT"; mediaPaths: string[] } {
  const videoOnly = NETWORK_STYLE[network].video === "always";
  if (input.mode === "own" && own) {
    const designed = input.overlays && own.format !== "SCRIPT" && !own.mediaPaths.some((p) => /\.(mp4|webm)$/i.test(p));
    return designed ? { format: "POST", mediaPaths: [] } : own;
  }
  if (!plan) return { format: videoOnly ? "SCRIPT" : "POST", mediaPaths: [] };
  if (plan.kind === "gallery-video") return videoOnly ? { format: "SCRIPT", mediaPaths: [plan.video.path] } : { format: "POST", mediaPaths: [plan.video.path] };
  if (plan.kind === "image") return { format: "POST", mediaPaths: [] };
  return { format: "SCRIPT", mediaPaths: [] };
}

