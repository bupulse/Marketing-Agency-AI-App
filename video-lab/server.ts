// BuPulse Video Lab (docs/VIDEO_ENGINE.md): a small local site for testing the video engine, separate from the app.
// Started by `npm run lab` (scripts/video-lab/start.mjs), listens on 127.0.0.1 only. It designs videos with Claude from
// the TEST database's products, keeps every test and its cost, and stores the MP4s the page renders.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { DESIGNER_MODEL, DESIGN_MODES, DesignError, apiSum, apiTransport, designVideo, estimateDesignCost, isPlatform, maxDesignCost, type BriefPhoto, type DesignBrief, type DesignMode, type DesignUsage, type Platform } from "@/lib/video-engine/designer";
import { cutoutForPhoto } from "./cutouts";
import { loadReferenceSources, type StudioRef } from "./seedance-sources";
import { prepareSeedanceReferences, type ReferenceSummary } from "./seedance-references";
import { STYLE_LIMITS, scoreCaption, templateStyle } from "@/lib/video-engine/brain/score";
import { firstCommentFor, planSeries, suggestHooks } from "@/lib/video-engine/brain";
import { brainBriefFromDesign, brainContext } from "@/lib/video-engine/brain/select";
import { blenderAvailable } from "./blender-jobs";
import { BLENDER_MIXES_AUDIO, getPremiumJob, listPremiumJobs, premiumVideoBytes, recoverPremiumJobs, rerenderPremium, startPremium3d } from "./premium-jobs";
import { subscriptionTransport } from "./claude-cli";
import { VIDEO_HOOKS } from "@/lib/video-engine/styles";
import { TEMPLATE_CATEGORIES, VIDEO_TEMPLATES, productMinHeight } from "@/lib/video-engine/templates";
import { CARTOON_CAST, castById } from "@/lib/video-engine/cast";
import { CAMERA_MOVES, GRADES, QUALITIES, RATIOS, isRatio, SPEC_LIMITS, totalMs, type MotionSpec, type Ratio } from "@/lib/video-engine/spec";
import { validateSpec } from "@/lib/video-engine/validate";
import { sampleSpec } from "@/lib/video-engine/sample";
import { closeDb, getBusiness, loadSavedKeys, listBusinesses, listProducts, musicBytes, musicFor, photoJpeg, saveUpload, uploadExists, uploadNote } from "./data-source";
import { IMAGE_RATIOS, INFLUENCERS, SHOT_ACTIONS, addImage, generateImage, listImages, listInfluencers, makePortrait, makeShot, portraitBytes } from "./influencers";
import MODELS from "./site/models.json";
import { DAILY_CAP_USD, getJob, kigaliDay, listJobs, listPreviews, newJobId, readVideo, record, savePreview, saveJob, saveVideo, spentToday, type LabJob } from "./store";
import { SEEDANCE_LIMITS, SEEDANCE_MODELS, SEEDANCE_RATIOS, SEEDANCE_RESOLUTIONS, checkSeedanceConnection, estimateSeedanceUsd, type SeedanceConnection, type SeedanceReference, type SeedanceRequest, type SeedanceResolution, type SeedanceTier } from "@/lib/video-engine/seedance";
import { BUSINESS_KINDS, SEEDANCE_FORMATS, checkSeedanceRequest, planSeedanceShots, type BusinessKind, type SeedanceFormat } from "@/lib/video-engine/seedance-brain";
import { listSeedanceExamples } from "./seedance-mock/preview";
import { seedanceOverlayCaption, seedanceOverlaySpec } from "@/lib/video-engine/seedance-overlay";
import { getOverlay, mp4Tracks, overlayVideoBytes, saveOverlay, saveOverlayVideo } from "./seedance-overlays";
import { listCharacters, previewPortraitPng } from "@/lib/video-engine/seedance-characters";
import { writeSeedancePrompt } from "@/lib/video-engine/seedance-prompt";
import { CLAUDE_VIDEO_CREDITS, CREDIT_PACKS, PREMIUM_3D_CREDITS, PREMIUM_RERENDER_CREDITS, PRESENTER_IMAGE_CREDITS, isPremiumQuality, type PremiumQuality, VOICE_OVER_CREDITS, charge, readWallet, refund, seedanceCredits, topUp } from "./credits";
import { VOICE_ROUTE, makeVoiceForJob, readVoiceMp3 } from "./voice";
import { cancelSeedance, getSeedanceJob, getSeedancePreview, listSeedanceJobs, resumeSeedanceJobs, seedanceReady, seedanceVideoBytes, submitSeedance } from "./seedance-jobs";
import { mediaBytes, saveMedia } from "./data-source";
import { RateLimiter, clearCookieHeader, clientIp, cookieValue, isLocal, loadSecret, loginPage, safeNext, sameText, setCookieHeader, tokenFor } from "./gate";

const PORT = Number(process.env.VIDEO_LAB_PORT || 3100);
const BUILD = path.resolve("video-lab/.build");
const FONTS = path.resolve("public/fonts/video");
const MAX_PHOTOS = 4;
const MAX_UPLOAD = 40 * 1024 * 1024;

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const fail = (res: http.ServerResponse, status: number, message: string) => json(res, status, { error: message });

async function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("Too large");
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

async function file(res: http.ServerResponse, full: string, type: string, cache = "no-store") {
  try {
    const bytes = await fs.readFile(full);
    res.writeHead(200, { "content-type": type, "cache-control": cache });
    res.end(bytes);
  } catch {
    fail(res, 404, "Not found");
  }
}

/**
 * Serves a video or audio file with Range support: the browser then reads only what it shows (a few KB for a
 * thumbnail) instead of downloading every MP4 on a page and holding all its connections to the studio open.
 */
function sendMedia(req: http.IncomingMessage, res: http.ServerResponse, bytes: Buffer, type: string, extra: Record<string, string> = {}) {
  const size = bytes.length;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...extra, "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) });
    return res.end(bytes.subarray(start, end + 1));
  }
  res.writeHead(200, { ...extra, "content-type": type, "accept-ranges": "bytes", "content-length": String(size) });
  res.end(bytes);
}

/**
 * How the lab reaches Claude. "subscription" (the owner's Claude Code login, tests only) when there is no API key or
 * VIDEO_LAB_CLAUDE=subscription; "api" otherwise. Before deploying anything, switch to the API key (docs/VIDEO_ENGINE.md).
 */
const claudeMode = (): "api" | "subscription" => (process.env.VIDEO_LAB_CLAUDE === "subscription" || !process.env.ANTHROPIC_API_KEY ? "subscription" : "api");

/** The designer's research score (lib/video-engine, coming): 0-100 with the rules it passed and failed. */
type DesignScore = { score: number; passed: unknown[]; failed: { rule: string; reason: string; scene?: number | null }[] };

type DesignRequest = {
  businessId: string;
  productId: string;
  photoIds: string[];
  styleId: string;
  hookId: string;
  ratio: Ratio;
  seconds: number;
  note: string | null;
  mode: DesignMode;
  fixedLens: boolean;
  base: LabJob | null;
  cartoonId: string | null;
  /** Where the video will be posted (optional): its safe area and best length go in the brief. */
  platform: Platform | null;
  /** An opening line the owner chose from the Brain's suggestions (GET /api/hooks). */
  chosenHook: { hookId: string; line: string } | null;
  /** An ad (the default) or an organic post on the business's own page: no price or contact hooks, a quieter caption. */
  purpose: "ad" | "post";
};

/** The opening line the page sent (both parts must be text), or null. */
function chosenHookOf(v: unknown): { hookId: string; line: string } | null {
  const h = v as { hookId?: unknown; line?: unknown } | null | undefined;
  return h && typeof h.hookId === "string" && typeof h.line === "string" ? { hookId: h.hookId.slice(0, 60), line: h.line.slice(0, 120) } : null;
}

/** Reads and checks a design request (new video, or edit / extend of an earlier test). */
async function readRequest(body: Record<string, unknown>): Promise<DesignRequest | { error: string; status: number }> {
  const mode: DesignMode = (DESIGN_MODES as readonly string[]).includes(String(body.mode)) ? (body.mode as DesignMode) : "reference";
  const base = mode === "edit" || mode === "extend" ? await getJob(String(body.baseJobId ?? "")) : null;
  if ((mode === "edit" || mode === "extend") && !base?.spec) return { status: 404, error: "Pick a finished video to edit or extend." };
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 600) : null;
  if (mode === "edit" && !note) return { status: 400, error: "Describe the change you want." };
  const businessId = base?.businessId ?? String(body.businessId ?? "");
  const productId = base?.productId ?? String(body.productId ?? "");
  const product = (await listProducts(businessId)).find((p) => p.id === productId);
  if (!product) return { status: 404, error: "Product not found." };
  const wanted = base ? base.photoIds : Array.isArray(body.photoIds) ? body.photoIds.map(String) : product.photos.map((p) => p.assetId);
  const photoIds = (await Promise.all(wanted.map(async (id) => ((product.photos.some((p) => p.assetId === id) || (await uploadExists(id))) ? id : null)))).filter((id): id is string => !!id).slice(0, MAX_PHOTOS);
  if (mode === "image" && photoIds.length < 1) return { status: 400, error: "Image to video needs one photo: pick it first." };
  if (mode === "firstLast" && photoIds.length < 2) return { status: 400, error: "First and last frame needs two photos: pick the first, then the last." };
  const maxExtra = base ? Math.max(0, SPEC_LIMITS.maxTotalSeconds - totalMs(base.spec as MotionSpec) / 1000) : 0;
  if (mode === "extend" && maxExtra < 2) return { status: 400, error: "This video is already 30 seconds, the longest a video can be." };
  const seconds = mode === "extend" ? Math.min(maxExtra, Math.max(2, Number(body.seconds) || 5)) : Math.min(SPEC_LIMITS.maxTotalSeconds, Math.max(4, Number(body.seconds) || 15));
  return {
    businessId,
    productId,
    photoIds,
    styleId: base?.styleId ?? String(body.styleId ?? VIDEO_TEMPLATES[0].id),
    hookId: base?.hookId ?? String(body.hookId ?? "auto"),
    ratio: (base?.spec?.ratio as Ratio) ?? (isRatio(body.ratio) ? body.ratio : "9:16"),
    seconds,
    note,
    mode,
    fixedLens: body.fixedLens === true,
    base,
    cartoonId: castById(String(body.cartoonId ?? ""))?.id ?? null,
    platform: isPlatform(body.platform) ? body.platform : null,
    chosenHook: chosenHookOf(body.chosenHook),
    // An edit or extend keeps its parent's purpose.
    purpose: ((base as { purpose?: string } | null)?.purpose ?? body.purpose) === "post" ? "post" : "ad",
  };
}

/**
 * The designer's brief for a request: the business, the product and the chosen photos (with whether each can be cut
 * out), plus the photo files themselves (JPEG and cut-out PNG) for engines that render on this Mac (Blender).
 */
async function briefFor(req: DesignRequest, variation: { index: number; of: number } | null, opts: { photos?: boolean } = {}): Promise<{ brief: DesignBrief; files: { jpeg: Buffer; cutout: Buffer | null }[] }> {
  const business = await getBusiness(req.businessId);
  const product = (await listProducts(req.businessId)).find((p) => p.id === req.productId);
  if (!business || !product) throw new Error("Product not found.");
  const photos: BriefPhoto[] = [];
  const files: { jpeg: Buffer; cutout: Buffer | null }[] = [];
  // Text-only briefs (the opening-line suggestions) skip the photos, which take the longest to load.
  for (const id of opts.photos === false ? [] : req.photoIds) {
    const p = await photoJpeg(id, 1280, req.businessId);
    const meta = product.photos.find((x) => x.assetId === id);
    const note = meta?.description ?? (id.startsWith("up-") ? ((await uploadNote(id)) ?? "uploaded by the owner") : undefined);
    // Whether the product can be lifted off its background (cached after the first time, 100 to 800 ms).
    const cut = await cutoutForPhoto(id, id.startsWith("up-") ? undefined : req.businessId);
    // The product's box in the photo (from its cut-out) keeps text off the product.
    photos.push({ base64: p.bytes.toString("base64"), mediaType: "image/jpeg", width: p.width, height: p.height, note, cutout: cut.ok, subject: cut.ok ? cut.box : null });
    files.push({ jpeg: p.bytes, cutout: cut.ok ? cut.png : null });
  }
  const brief: DesignBrief = {
    business: { name: business.name, description: business.description, language: business.language, colors: business.colors, phone: business.phone, website: business.website, country: business.country, tone: business.tone },
    product: { name: product.name, summary: product.summary, description: product.description, price: product.price, usps: product.usps, features: product.features, targetCustomer: product.targetCustomer },
    photos,
    styleId: req.styleId,
    hookId: req.hookId,
    ratio: req.ratio,
    seconds: req.seconds,
    note: req.note,
    mode: req.mode,
    base: req.base?.spec ?? null,
    fixedLens: req.fixedLens,
    cartoonId: req.cartoonId,
    variation,
    platform: req.platform,
  };
  // The Brain (context, design score, hooks) reads `purpose` off the brief: "post" means a page post, not an ad.
  Object.assign(brief, { purpose: req.purpose });
  return { brief, files };
}

/** One design (one version). Records the usage before anything else, saves the test, never throws. */
async function designOne(req: DesignRequest, variation: { index: number; of: number } | null): Promise<LabJob> {
  const mode = claudeMode();
  const business = await getBusiness(req.businessId);
  const product = (await listProducts(req.businessId)).find((p) => p.id === req.productId);
  const job: LabJob = {
    id: newJobId(),
    createdAt: new Date().toISOString(),
    engine: "claude",
    businessId: req.businessId,
    businessName: business?.name ?? "",
    productId: req.productId,
    productName: product?.name ?? "",
    styleId: req.styleId,
    hookId: req.hookId,
    ratio: req.ratio,
    seconds: req.seconds,
    note: req.note,
    photoIds: req.photoIds,
    spec: null,
    usage: [],
    costUsd: 0,
    status: "designed",
    error: null,
    video: null,
    edited: false,
    mode: req.mode,
    fixedLens: req.fixedLens,
    parentId: req.base?.id ?? null,
    version: variation ? `${variation.index}/${variation.of}` : null,
  };
  try {
    if (!business || !product) throw new Error("Product not found.");
    const { brief } = await briefFor(req, variation);
    // The opening line the owner picked: the Brain's context for it goes in as research (Claude follows it).
    if (req.chosenHook) brief.research = brainContext(brainBriefFromDesign(brief, req.platform === "youtube" ? "shorts" : req.platform), { chosenHook: req.chosenHook });
    const result = await designVideo(brief, mode === "api" ? { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL } : { transport: subscriptionTransport(), model: process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL });
    await record(job.id, "claude-design", result.usage);
    Object.assign(job, { spec: result.spec, usage: result.usage, costUsd: result.costUsd, apiEquivalentUsd: result.apiEquivalentUsd, billedTo: mode });
    // The fact check's warnings, and the research score once the designer returns one; saved with the job for the page.
    const checked = result as typeof result & { score?: DesignScore };
    Object.assign(job, { warnings: checked.warnings ?? [], purpose: req.purpose, ...(checked.score ? { score: checked.score } : {}) });
    // The caption check (lib/video-engine/brain/score.ts). An edit or extend that kept the caption keeps its check.
    const parent = req.base as (LabJob & { captionScore?: number; captionMissed?: string[] }) | null;
    const sameCaption = parent?.spec && parent.captionScore !== undefined && parent.spec.caption === result.spec.caption && parent.spec.hashtags.join(" ") === result.spec.hashtags.join(" ");
    if (sameCaption) Object.assign(job, { captionScore: parent.captionScore, captionMissed: parent.captionMissed ?? [] });
    else {
      // The Brain's "mode" means ad or post, not the design mode: our designs are ads (its default).
      const cap = scoreCaption(result.spec.caption, result.spec.hashtags, brief, { platform: brief.platform, purpose: req.purpose });
      Object.assign(job, { captionScore: cap.score, captionMissed: cap.missed });
    }
  } catch (error) {
    const usage = error instanceof DesignError ? error.usage : [];
    await record(job.id, "claude-design", usage);
    Object.assign(job, { status: "failed", usage, costUsd: usage.reduce((s, u) => s + u.costUsd, 0), apiEquivalentUsd: apiSum(usage), billedTo: mode, error: error instanceof Error ? error.message : "Design failed." });
  }
  await saveJob(job);
  return job;
}

/** One request: 1 to 4 versions (like Higgsfield's batch), two at a time. */
async function design(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const req = await readRequest(body);
  if ("error" in req) return { status: req.status, body: { error: req.error } };
  const versions = req.mode === "edit" || req.mode === "extend" ? 1 : Math.min(4, Math.max(1, Math.round(Number(body.versions) || 1)));
  if (claudeMode() === "api") {
    const spent = await spentToday();
    const worst = maxDesignCost(req.photoIds.length) * versions;
    if (spent + worst > DAILY_CAP_USD) return { status: 429, body: { error: `Today's test budget is used: $${spent.toFixed(2)} of $${DAILY_CAP_USD.toFixed(2)}. More tomorrow (Kigali time).` } };
  }
  // Credits are taken first and given back for every failed version.
  try {
    await charge(CLAUDE_VIDEO_CREDITS * versions, `Motion video${versions > 1 ? ` x${versions}` : ""} (${req.mode})`);
  } catch (error) {
    return { status: 402, body: { error: error instanceof Error ? error.message : "Not enough credits." } };
  }
  const jobs: LabJob[] = [];
  for (let i = 0; i < versions; i += 2) {
    const batch = [i, i + 1].filter((n) => n < versions).map((n) => designOne(req, versions > 1 ? { index: n + 1, of: versions } : null));
    jobs.push(...(await Promise.all(batch)));
  }
  const failed = jobs.filter((j) => j.status === "failed");
  if (failed.length) await refund(CLAUDE_VIDEO_CREDITS * failed.length, "Motion video failed");
  const ok = jobs.filter((j) => j.status !== "failed");
  return { status: ok.length ? 200 : 502, body: { jobs, error: ok.length ? null : jobs[0]?.error } };
}

const PAGES = path.join(BUILD, "pages");
const PAGE_ROUTES: Record<string, string> = {
  "/": "home",
  "/create": "create",
  "/showcase": "showcase",
  "/videos": "videos",
  "/pricing": "pricing",
  "/guide": "guide",
  "/api-docs": "api-docs",
  // One generator page per model (built by scripts/video-lab/start.mjs from video-lab/site/models.json).
  ...Object.fromEntries(MODELS.map((m) => [m.route, m.group === "image" ? "image" : `model-${m.id}`])),
};
/** Old links and seedance2ai-style paths, so no link ends on "Not found". */
const REDIRECTS: Record<string, string> = {
  "/app/video/seedance": "/app/video/seedance-2-0",
  "/app/video": "/app/video/seedance-2-0",
  "/app/image": "/app/image/nano-banana",
  "/templates": "/create#tgrid",
  "/app": "/create",
  "/developers": "/api-docs",
  "/explore": "/showcase",
  "/prompt-guide": "/guide",
};
/** Free re-shapes of a finished Motion design, and the network each is for. */
const RESHAPES: Record<string, { platform: Platform }> = { "1:1": { platform: "facebook" }, "4:5": { platform: "instagram" } };
const TIER_PAGES: Record<string, string> = { pro: "/app/video/seedance-2-0", fast: "/app/video/seedance-2-0-fast", mini: "/app/video/seedance-2-0-mini" };

const labelFor = (r: { kind: string; label?: unknown }, n: number) => `${r.kind === "image" ? "Image" : r.kind === "video" ? "Video" : "Audio"} ${n}: ${typeof r.label === "string" ? r.label.slice(0, 120) : r.kind}`;

/**
 * Turns the page's reference ids (ph: product photo, up: upload, co: cut-out, pp: presenter portrait, asset: digital
 * character, um: media, vid: a studio video) into BytePlus references (video-lab/seedance-sources.ts loads them,
 * video-lab/seedance-references.ts fits them to BytePlus's limits). `problems` says what was left out and why.
 */
async function resolveReferences(refs: StudioRef[], businessId: string): Promise<{ references: SeedanceReference[]; notes: string[]; problems: string[]; summary: ReferenceSummary[] }> {
  const src = await loadReferenceSources(refs, businessId);
  const p = await prepareSeedanceReferences(src.sources);
  return { references: p.references, notes: p.notes, problems: [...src.problems, ...p.problems], summary: p.summary };
}

/** The page's Seedance settings as a BytePlus request (shared by submit and check). The prompt may be empty here. */
async function seedanceRequestFrom(body: Record<string, unknown>) {
  const tier = (String(body.tier) in SEEDANCE_MODELS ? body.tier : "fast") as SeedanceTier;
  const allowed = SEEDANCE_MODELS[tier].resolutions as readonly string[];
  // The resolution is passed as asked, so the check can say when a quality cannot make it.
  const resolution = ((SEEDANCE_RESOLUTIONS as readonly string[]).includes(String(body.resolution)) ? body.resolution : allowed[allowed.length - 1]) as SeedanceResolution;
  const ratio = (SEEDANCE_RATIOS as readonly string[]).includes(String(body.ratio)) ? (body.ratio as SeedanceRequest["ratio"]) : "9:16";
  const seconds = Math.min(SEEDANCE_LIMITS.maxSeconds, Math.max(SEEDANCE_LIMITS.minSeconds, Math.round(Number(body.seconds) || 5)));
  const businessId = String(body.businessId ?? "");
  const product = businessId ? (await listProducts(businessId)).find((x) => x.id === String(body.productId ?? "")) : undefined;
  const { references, notes, problems } = await resolveReferences(Array.isArray(body.refs) ? body.refs : [], businessId);
  const seed = Number.isFinite(Number(body.seed)) && body.seed !== null && body.seed !== "" ? Number(body.seed) : null;
  const request: SeedanceRequest = { tier, prompt: String(body.prompt ?? "").trim(), references, ratio, seconds, resolution, audio: body.audio !== false, fixedLens: body.fixedLens === true, seed, flex: body.flex === true, draft: body.draft === true };
  return { request, notes, problems, product, businessId, versions: Math.min(3, Math.max(1, Number(body.versions) || 1)) };
}

/**
 * The cut-outs already made (<id>.png) and refused (<id>.json alone) in video-lab/cutouts.ts's cache folder: a
 * directory listing, so nothing is computed here.
 */
async function knownCutouts(): Promise<{ ok: Set<string>; refused: Set<string> }> {
  const files = await fs.readdir(path.resolve("video-lab/data/cutouts")).catch(() => [] as string[]);
  const ids = (ext: string) => new Set(files.filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)));
  const ok = ids(".png");
  // A made cut-out also keeps its product box in <id>.json: refused means a .json with no .png.
  return { ok, refused: new Set([...ids(".json")].filter((id) => !ok.has(id))) };
}

/**
 * A stand-in for a Seedance clip while there is none (preview mode): the newest finished Motion MP4 with a sound track,
 * of the same product and shape when there is one, so the overlay's video layer and the clip's own audio can be tried
 * end to end.
 */
async function standInClip(productId: string, ratio: string): Promise<string | null> {
  // Closest to what the real clip will show first: the same product and shape (re-shapes left out), then any.
  const jobs = (await listJobs()).filter((j) => j.video && j.mode !== "reshape");
  const rank = (j: { productId: string; ratio: string }) => (j.productId === productId ? 0 : 2) + (j.ratio === ratio ? 0 : 1);
  for (const j of [...jobs].sort((a, b) => rank(a) - rank(b))) {
    const bytes = await readVideo(j.id);
    if (bytes && mp4Tracks(bytes).includes("soun")) return `/videos/${j.id}.mp4`;
  }
  return null;
}

/** The BytePlus connection, checked at most every 5 minutes (the check lists one task: free). */
let seedanceStatus: { at: number; value: SeedanceConnection } | null = null;
async function seedanceConnection(): Promise<SeedanceConnection> {
  if (!seedanceStatus || Date.now() - seedanceStatus.at > 5 * 60_000) seedanceStatus = { at: Date.now(), value: await checkSeedanceConnection() };
  return seedanceStatus.value;
}

const loginTries = new RateLimiter(10, 10 * 60_000);
let gateSecret: Buffer | null = null;
const html = (res: http.ServerResponse, status: number, body: string) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
};

/**
 * The password gate (video-lab/gate.ts) for online access. True when the request may go on; otherwise it has been
 * answered: the sign-in page, the sign-in itself, a redirect to it, or 401 for the API.
 */
async function gate(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const password = process.env.STUDIO_PASSWORD ?? "";
  const secret = (gateSecret ??= await loadSecret());
  const signedIn = !!password && sameText(cookieValue(req.headers) ?? "", tokenFor(password, secret));
  if (p === "/logout") {
    res.writeHead(303, { "set-cookie": clearCookieHeader(req.headers), location: "/login" });
    res.end();
    return false;
  }
  if (isLocal(req.headers, PORT) || signedIn) {
    if (p !== "/login") return true;
    res.writeHead(303, { location: safeNext(url.searchParams.get("next")) });
    res.end();
    return false;
  }
  if (req.method === "GET" && p === "/site.css") return true;
  if (!password) {
    fail(res, 503, "The studio is locked: STUDIO_PASSWORD is not set on the studio computer.");
    return false;
  }
  if (p === "/login" && req.method === "GET") {
    html(res, 200, loginPage(safeNext(url.searchParams.get("next")), null));
    return false;
  }
  if (p === "/login" && req.method === "POST") {
    const form = new URLSearchParams((await readBody(req, 4096)).toString("utf8"));
    const next = safeNext(form.get("next"));
    if (!loginTries.hit(clientIp(req))) {
      html(res, 429, loginPage(next, "Too many tries. Wait 10 minutes, then try again."));
      return false;
    }
    if (!sameText(form.get("password") ?? "", password)) {
      html(res, 401, loginPage(next, "That password is not right. Try again."));
      return false;
    }
    res.writeHead(303, { "set-cookie": setCookieHeader(tokenFor(password, secret), req.headers), location: next });
    res.end();
    return false;
  }
  if (p.startsWith("/api/") || req.method !== "GET") {
    fail(res, 401, "Sign in first: open the studio and enter the password.");
    return false;
  }
  res.writeHead(302, { location: `/login?next=${encodeURIComponent(p + url.search)}` });
  res.end();
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  // The studio is a private test site: never in search results, online or not.
  res.setHeader("x-robots-tag", "noindex, nofollow");
  try {
    if (!(await gate(req, res, url))) return;
    if (req.method === "GET" && PAGE_ROUTES[p]) return file(res, path.join(PAGES, `${PAGE_ROUTES[p]}.html`), "text/html; charset=utf-8");
    if (req.method === "GET" && REDIRECTS[p]) {
      // Keeps the query (the old ?tier= links go to that model's page; ?prompt= and ?ref= pass through).
      const tier = url.searchParams.get("tier");
      const target = p === "/app/video/seedance" && tier && TIER_PAGES[tier] ? TIER_PAGES[tier] : REDIRECTS[p];
      url.searchParams.delete("tier");
      const query = url.searchParams.toString();
      res.writeHead(302, { location: query && !target.includes("#") ? `${target}?${query}` : target });
      return res.end();
    }
    const stat = p.match(/^\/static\/([a-z0-9-]{1,60})\.(png|jpg|webp)$/);
    if (req.method === "GET" && stat) return file(res, path.join(BUILD, "static", `${stat[1]}.${stat[2]}`), stat[2] === "jpg" ? "image/jpeg" : `image/${stat[2]}`, "max-age=3600");
    if (req.method === "GET" && p === "/lab") return file(res, path.join(BUILD, "lab.html"), "text/html; charset=utf-8");
    if (req.method === "GET" && p === "/app.js") return file(res, path.join(BUILD, "js", "lab.js"), "text/javascript; charset=utf-8");
    if (req.method === "GET" && p === "/site.css") return file(res, path.join(BUILD, "site.css"), "text/css; charset=utf-8");
    const js = p.match(/^\/js\/([a-z]+)\.js$/);
    if (req.method === "GET" && js) return file(res, path.join(BUILD, "js", `${js[1]}.js`), "text/javascript; charset=utf-8");
    if (req.method === "GET" && p === "/api/wallet") return json(res, 200, await readWallet());
    if (req.method === "POST" && p === "/api/wallet/topup") {
      // Test wallet only: no payment. In the app, MoMo and plan allowances take over (docs/MOMO.md).
      const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}");
      const pack = CREDIT_PACKS.find((x) => x.id === String(body.pack));
      if (!pack) return fail(res, 404, "Unknown pack.");
      return json(res, 200, await topUp(pack.credits, `${pack.name} (test, no payment)`));
    }
    if (req.method === "GET" && p === "/api/pricing") {
      const tiers = Object.keys(SEEDANCE_MODELS) as SeedanceTier[];
      return json(res, 200, {
        packs: CREDIT_PACKS,
        seedance: tiers.flatMap((tier) => SEEDANCE_MODELS[tier].resolutions.map((resolution) => ({ tier, name: SEEDANCE_MODELS[tier].name, resolution, credits5s: seedanceCredits(tier, resolution as SeedanceResolution, 5), credits10s: seedanceCredits(tier, resolution as SeedanceResolution, 10), credits15s: seedanceCredits(tier, resolution as SeedanceResolution, 15) }))),
        claudeCredits: CLAUDE_VIDEO_CREDITS,
        presenterCredits: PRESENTER_IMAGE_CREDITS,
        voiceCredits: VOICE_OVER_CREDITS,
        premium3dCredits: { ...PREMIUM_3D_CREDITS, rerender: PREMIUM_RERENDER_CREDITS },
      });
    }
    if (req.method === "POST" && p === "/api/quote") {
      const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}");
      const versions = Math.min(4, Math.max(1, Number(body.versions) || 1));
      if (body.engine === "seedance") {
        const tier = (body.tier in SEEDANCE_MODELS ? body.tier : "fast") as SeedanceTier;
        const resolution = (SEEDANCE_RESOLUTIONS as readonly string[]).includes(body.resolution) ? (body.resolution as SeedanceResolution) : "720p";
        const seconds = Math.min(SEEDANCE_LIMITS.maxSeconds, Math.max(SEEDANCE_LIMITS.minSeconds, Number(body.seconds) || 5));
        return json(res, 200, { credits: seedanceCredits(tier, resolution, seconds) * versions, usd: estimateSeedanceUsd({ tier, resolution, seconds }) * versions });
      }
      if (body.engine === "blender") return json(res, 200, { credits: PREMIUM_3D_CREDITS[(isPremiumQuality(body.quality) ? body.quality : "540p") as PremiumQuality], usd: estimateDesignCost(Math.min(4, Number(body.photos) || 0)) });
      // A Motion video with a voice-over: the design now, the voice when the MP4 is made.
      const voice = body.voice === true ? VOICE_OVER_CREDITS : 0;
      return json(res, 200, { credits: (CLAUDE_VIDEO_CREDITS + voice) * versions, usd: estimateDesignCost(Math.min(4, Number(body.photos) || 0)) * versions, voiceCredits: voice * versions });
    }
    if (req.method === "GET" && p === "/api/showcase") {
      const [cl, sd, pm] = await Promise.all([listJobs(), listSeedanceJobs(), listPremiumJobs()]);
      const items = [
        // Preview jobs (no key yet) are storyboards, not videos: they stay out of the showcase.
        ...sd.filter((j) => !j.preview).map((j) => ({ id: j.id, engine: "seedance", title: j.title, createdAt: j.createdAt, status: j.status, videoUrl: j.videoFile ? `/videos/seedance/${j.id}.mp4` : null, prompt: j.request.prompt, info: { Quality: `${j.request.tier} · ${j.request.resolution} · ${j.request.seconds} s`, Credits: String(j.credits), "Provider cost": j.costUsd ? `$${j.costUsd.toFixed(3)}` : `about $${j.estimateUsd.toFixed(2)}` } })),
        // A clip rendered again shows once: the newer render replaces its parent.
        ...pm.filter((j) => j.videoFile && !pm.some((x) => x.parentId === j.id && x.videoFile)).map((j) => ({ id: j.id, engine: "blender", title: j.title, createdAt: j.createdAt, status: j.status, videoUrl: `/videos/blender/${j.id}.mp4`, prompt: j.caption ?? j.note ?? "", info: { Engine: "Premium 3D (Blender)", Length: `${j.seconds} s`, Credits: String(j.credits), "Render time": j.renderSeconds ? `${j.renderSeconds} s` : "" } })),
        ...cl.filter((j) => j.styleId !== "sample").map((j) => ({ id: j.id, engine: "claude", title: j.productName, createdAt: j.createdAt, status: j.video ? "succeeded" : j.status, videoUrl: j.video ? `/videos/${j.id}.mp4` : null, prompt: j.note ?? "", info: { Template: j.styleId, Shape: j.ratio, "API-equivalent cost": `$${(j.apiEquivalentUsd ?? 0).toFixed(3)}` } })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(res, 200, { items });
    }
    if (req.method === "POST" && p === "/api/media") {
      // Video or audio reference uploads for Seedance (kept in video-lab/data/media).
      const bytes = await readBody(req, 60 * 1024 * 1024);
      const type = String(req.headers["content-type"] ?? "");
      return json(res, 200, await saveMedia(bytes, type));
    }
    const media = p.match(/^\/api\/media\/(um-[0-9a-f]{12})$/);
    if (req.method === "GET" && media) {
      const m = await mediaBytes(media[1]);
      if (!m) return fail(res, 404, "Not found");
      return sendMedia(req, res, m.bytes, m.mimeType);
    }
    if (req.method === "POST" && p === "/api/seedance/prompt") {
      const body = JSON.parse((await readBody(req, 32 * 1024)).toString("utf8") || "{}");
      const business = await getBusiness(String(body.businessId ?? ""));
      const product = business ? (await listProducts(business.id)).find((x) => x.id === String(body.productId ?? "")) : undefined;
      if (!business || !product) return fail(res, 404, "Pick a product first.");
      const refs = Array.isArray(body.references) ? (body.references as { kind: string; label?: unknown }[]) : [];
      const counts = { image: 0, video: 0, audio: 0 };
      const references = refs.map((r) => labelFor(r, (counts[r.kind as "image" | "video" | "audio"] = (counts[r.kind as "image" | "video" | "audio"] ?? 0) + 1)));
      const mode = claudeMode();
      const model = process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL;
      const send = mode === "api" ? apiTransport(process.env.ANTHROPIC_API_KEY as string) : subscriptionTransport();
      const out = await writeSeedancePrompt(
        { business: { name: business.name, description: business.description, language: business.language, country: business.country }, product: { name: product.name, summary: product.summary, description: product.description, price: product.price, usps: product.usps, features: product.features }, references, templateId: String(body.templateId ?? "product-hero"), note: typeof body.note === "string" ? body.note.slice(0, 600) : null, seconds: Number(body.seconds) || 5, ratio: String(body.ratio ?? "9:16"), audio: body.audio !== false, presenter: typeof body.presenter === "string" ? body.presenter : null },
        send,
        model,
      );
      await record(newJobId(), "claude-seedance-prompt", [out.usage]);
      return json(res, 200, { prompt: out.prompt, issues: out.issues, fallback: out.fallback ?? null });
    }
    if (req.method === "POST" && p === "/api/seedance/plan") {
      // BuPulse's own shot plan from the product (lib/video-engine/seedance-brain.ts): free and instant, no AI.
      const body = JSON.parse((await readBody(req, 32 * 1024)).toString("utf8") || "{}");
      const business = await getBusiness(String(body.businessId ?? ""));
      const product = business ? (await listProducts(business.id)).find((x) => x.id === String(body.productId ?? "")) : undefined;
      if (!business || !product) return fail(res, 404, "Pick a product first.");
      const refs = Array.isArray(body.references) ? (body.references as { kind: string; label?: unknown }[]) : [];
      const counts = { image: 0, video: 0, audio: 0 };
      const references = refs.map((r) => labelFor(r, (counts[r.kind as "image" | "video" | "audio"] = (counts[r.kind as "image" | "video" | "audio"] ?? 0) + 1)));
      const plan = planSeedanceShots({
        business: { name: business.name, description: business.description, language: business.language, country: business.country },
        product: { name: product.name, summary: product.summary, description: product.description, price: product.price, usps: product.usps, features: product.features },
        references,
        templateId: typeof body.templateId === "string" ? body.templateId : null,
        seconds: Number(body.seconds) || 5,
        ratio: String(body.ratio ?? "9:16"),
        audio: body.audio !== false,
        fixedLens: body.fixedLens === true,
        presenter: typeof body.presenter === "string" ? body.presenter : null,
        variant: Number(body.variant) || 0,
      });
      return json(res, 200, plan);
    }
    if (req.method === "POST" && p === "/api/seedance/check") {
      // The same request Generate would send, checked before anything is paid (errors block Generate).
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const { request, notes, problems } = await seedanceRequestFrom(body);
      return json(res, 200, { ...checkSeedanceRequest(request, { referenceNotes: notes }), problems });
    }
    if (req.method === "GET" && p === "/api/seedance/examples") {
      // The "Get inspired" storyboards (made by scripts/video-lab/seedance-examples.mjs), read fresh each time.
      const sector = BUSINESS_KINDS.find((k) => k.id === url.searchParams.get("sector"))?.id ?? null;
      const format = SEEDANCE_FORMATS.find((f) => f.id === url.searchParams.get("format"))?.id ?? null;
      return json(res, 200, {
        examples: await listSeedanceExamples({ sector: sector as BusinessKind | null, format: format as SeedanceFormat | null }),
        sectors: BUSINESS_KINDS.map(({ id, name }) => ({ id, name })),
        formats: SEEDANCE_FORMATS.map(({ id, name }) => ({ id, name })),
      });
    }
    if (req.method === "GET" && p === "/api/seedance/characters") {
      // ModelArk digital characters (presenters Seedance accepts), or drawn previews until the BytePlus keys are in.
      return json(res, 200, await listCharacters());
    }
    const charPortrait = p.match(/^\/api\/seedance\/characters\/(preview-[a-z]+)\/portrait\.png$/);
    if (req.method === "GET" && charPortrait) {
      const png = await previewPortraitPng(charPortrait[1]);
      if (!png) return fail(res, 404, "Not found");
      res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400" });
      return res.end(png);
    }
    if (req.method === "GET" && p === "/api/seedance/status") {
      const c = await seedanceConnection();
      return json(res, 200, { state: c.state, message: c.message, mode: seedanceReady() ? "live" : "preview" });
    }
    if (req.method === "POST" && p === "/api/seedance/submit") {
      // Without the BytePlus key this makes a free preview (a storyboard); with it, a real paid job.
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const { request, notes, problems, product, businessId, versions } = await seedanceRequestFrom(body);
      if (!request.prompt) return fail(res, 400, "Write a prompt first.");
      const check = checkSeedanceRequest(request, { referenceNotes: notes });
      if (!check.ok) return json(res, 400, { error: check.issues.find((i) => i.level === "error")?.message ?? "This request cannot be sent.", issues: check.issues });
      const jobs = [];
      for (let i = 0; i < versions; i++) {
        jobs.push(await submitSeedance({ ...request, seed: i === 0 ? request.seed : null }, { businessId: businessId || null, productId: product?.id ?? null, title: product?.name ?? request.prompt.slice(0, 40), referenceNotes: notes }));
      }
      return json(res, 200, { jobs, problems });
    }
    if (req.method === "GET" && p === "/api/seedance/jobs") return json(res, 200, { jobs: await listSeedanceJobs() });
    const sdOverlay = p.match(/^\/api\/seedance\/jobs\/(sd-[0-9a-f]{12})\/overlay(\/video)?$/);
    if (sdOverlay) {
      const id = sdOverlay[1];
      if (req.method === "GET" && !sdOverlay[2]) {
        const o = await getOverlay(id);
        return o ? json(res, 200, o) : fail(res, 404, "No text added yet.");
      }
      if (req.method === "POST" && !sdOverlay[2]) {
        // "Add BuPulse text": the hook, price, phone bar and call to action drawn over the clip (free, no AI).
        const job = await getSeedanceJob(id);
        if (!job) return fail(res, 404, "Not found");
        const preview = !!job.preview;
        if (!preview && (job.status !== "succeeded" || !job.videoFile)) return fail(res, 400, "The clip is not ready yet.");
        const business = job.businessId ? await getBusiness(job.businessId) : null;
        const product = business && job.productId ? (await listProducts(business.id)).find((x) => x.id === job.productId) : undefined;
        if (!business || !product) return fail(res, 400, "This clip was made without a product, so there is no price or number to add.");
        // Until a real clip exists (preview mode), a finished studio MP4 with sound stands in, so the step can be tried.
        const clipUrl = preview ? await standInClip(product.id, job.request.ratio === "adaptive" ? "9:16" : job.request.ratio) : `/videos/seedance/${id}.mp4`;
        if (!clipUrl) return fail(res, 400, "There is no finished studio video to stand in for the Seedance clip yet.");
        const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}");
        const platform = isPlatform(body.platform) ? body.platform : null;
        const brief = {
          business: { name: business.name, description: business.description, language: business.language, country: business.country, phone: business.phone },
          product: { name: product.name, summary: product.summary, description: product.description, price: product.price, usps: product.usps, features: product.features },
          references: job.request.referenceNotes,
          templateId: "product-hero",
          seconds: job.request.seconds,
          ratio: job.request.ratio === "adaptive" ? "9:16" : job.request.ratio,
          audio: job.request.audio,
          platform,
        };
        const raw = seedanceOverlaySpec({ brief, clipUrl, prompt: job.request.prompt, seconds: job.request.seconds });
        const spec = validateSpec(raw, { ratio: (isRatio(raw.ratio) ? raw.ratio : "9:16") as Ratio, photoCount: 0, seconds: totalMs(raw) / 1000, platform, phone: business.phone });
        const cap = seedanceOverlayCaption(brief);
        const overlay = { jobId: id, createdAt: new Date().toISOString(), spec, clipUrl, standIn: preview, captionScore: cap.score.score, captionMissed: cap.score.missed, video: null };
        await saveOverlay(overlay);
        return json(res, 200, overlay);
      }
      if (req.method === "POST" && sdOverlay[2]) {
        // The MP4 the browser made from the overlay: kept as the job's "with text" version.
        const o = await getOverlay(id);
        if (!o) return fail(res, 404, "Add the text first.");
        const bytes = await readBody(req, MAX_UPLOAD);
        if (bytes.length < 1000 || bytes.subarray(4, 8).toString("latin1") !== "ftyp") return fail(res, 400, "That is not an MP4 file.");
        await saveOverlayVideo(id, bytes);
        o.video = { bytes: bytes.length, savedAt: new Date().toISOString(), quality: String(url.searchParams.get("q") ?? "1080p") };
        await saveOverlay(o);
        return json(res, 200, { ...o, tracks: mp4Tracks(bytes) });
      }
    }
    const sdText = p.match(/^\/videos\/seedance\/(sd-[0-9a-f]{12})-text\.mp4$/);
    if (req.method === "GET" && sdText) {
      const bytes = await overlayVideoBytes(sdText[1]);
      return bytes ? sendMedia(req, res, bytes, "video/mp4", { "content-disposition": `inline; filename="bupulse-${sdText[1]}-text.mp4"` }) : fail(res, 404, "Not found");
    }
    const sdJob = p.match(/^\/api\/seedance\/jobs\/(sd-[0-9a-f]{12})(\/cancel|\/preview)?$/);
    if (sdJob) {
      if (req.method === "GET" && sdJob[2] === "/preview") {
        const pv = await getSeedancePreview(sdJob[1]);
        return pv ? json(res, 200, pv) : fail(res, 404, "No preview for this job.");
      }
      if (req.method === "GET" && !sdJob[2]) {
        const j = await getSeedanceJob(sdJob[1]);
        return j ? json(res, 200, j) : fail(res, 404, "Not found");
      }
      if (req.method === "POST" && sdJob[2] === "/cancel") {
        const j = await cancelSeedance(sdJob[1]);
        return j ? json(res, 200, j) : fail(res, 404, "Not found");
      }
    }
    const sdVideo = p.match(/^\/videos\/seedance\/(sd-[0-9a-f]{12})\.mp4$/);
    if (req.method === "GET" && sdVideo) {
      const bytes = await seedanceVideoBytes(sdVideo[1]);
      if (!bytes) return fail(res, 404, "Not found");
      return sendMedia(req, res, bytes, "video/mp4", { "content-disposition": `inline; filename="bupulse-${sdVideo[1]}.mp4"` });
    }
    if (req.method === "GET" && p.startsWith("/fonts/video/")) {
      const name = path.basename(p);
      if (!/^[a-z0-9-]+\.woff2$/.test(name)) return fail(res, 404, "Not found");
      return file(res, path.join(FONTS, name), "font/woff2", "max-age=86400");
    }
    if (req.method === "GET" && p === "/api/options") {
      return json(res, 200, {
        categories: TEMPLATE_CATEGORIES,
        templates: VIDEO_TEMPLATES.map(({ id, category, name, blurb, seconds, hook, presenter }) => ({ id, category, name, blurb, seconds, hook, presenter: !!presenter })),
        hooks: VIDEO_HOOKS.map(({ id, name }) => ({ id, name })),
        ratios: Object.keys(RATIOS),
        qualities: Object.keys(QUALITIES),
        modes: DESIGN_MODES,
        cameraMoves: CAMERA_MOVES,
        grades: GRADES,
        cast: CARTOON_CAST.map(({ id, name, about }) => ({ id, name, about })),
        model: process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL,
        capUsd: DAILY_CAP_USD,
        spentUsd: await spentToday(),
        estimateUsd: [0, 1, 2, 3, 4].map((n) => estimateDesignCost(n)),
        seedanceReady: seedanceReady(),
        seedance: { tiers: (Object.keys(SEEDANCE_MODELS) as SeedanceTier[]).map((tier) => ({ ...SEEDANCE_MODELS[tier], id: tier, model: SEEDANCE_MODELS[tier].id })), ratios: SEEDANCE_RATIOS, limits: { minSeconds: SEEDANCE_LIMITS.minSeconds, maxSeconds: SEEDANCE_LIMITS.maxSeconds } },
        claudeReady: true,
        claudeMode: claudeMode(),
      });
    }
    if (req.method === "GET" && p === "/api/businesses") return json(res, 200, await listBusinesses());
    if (req.method === "GET" && p === "/api/products") {
      // Each photo says whether its cut-out is known (true), known to be impossible (false) or not checked yet (null).
      const known = await knownCutouts();
      const products = await listProducts(url.searchParams.get("business") ?? "");
      return json(res, 200, products.map((x) => ({ ...x, photos: x.photos.map((ph) => ({ ...ph, cutout: known.ok.has(ph.assetId) ? true : known.refused.has(ph.assetId) ? false : null })) })));
    }
    if (req.method === "GET" && p === "/api/cutouts") {
      // So the page asks for a cut-out only when one exists or was never tried (no 404 per photo in the console).
      const known = await knownCutouts();
      return json(res, 200, { ok: [...known.ok], refused: [...known.refused] });
    }
    const photo = p.match(/^\/api\/photo\/([A-Za-z0-9-]{8,40})$/);
    if (req.method === "GET" && photo && url.searchParams.get("cutout") === "1") {
      // The product lifted off its background (video-lab/cutouts.ts), for 3D turntables and floating products.
      const c = await cutoutForPhoto(photo[1]).catch(() => ({ ok: false as const, reason: "Photo not found." }));
      if (!c.ok) return json(res, 404, { error: c.reason });
      res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400" });
      return res.end(c.png);
    }
    if (req.method === "GET" && photo) {
      const size = url.searchParams.get("size") === "thumb" ? 360 : 1600;
      const out = await photoJpeg(photo[1], size);
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=3600" });
      return res.end(out.bytes);
    }
    if (req.method === "GET" && p === "/api/influencers") return json(res, 200, { influencers: await listInfluencers(), actions: SHOT_ACTIONS });
    const infl = p.match(/^\/api\/influencers\/([a-z-]{2,20})\/(portrait|shot)$/);
    if (infl && INFLUENCERS.some((i) => i.id === infl[1])) {
      if (req.method === "GET" && infl[2] === "portrait") {
        const bytes = await portraitBytes(infl[1]);
        if (!bytes) return fail(res, 404, "No portrait yet.");
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
        return res.end(bytes);
      }
      if (req.method === "POST") {
        // Gemini images cost real money (about $0.039 each): checked against the daily cap and recorded first.
        const spent = await spentToday();
        if (spent + 0.08 > DAILY_CAP_USD) return fail(res, 429, `Today's test budget is used: $${spent.toFixed(2)} of $${DAILY_CAP_USD.toFixed(2)}.`);
        const jobId = newJobId();
        await charge(PRESENTER_IMAGE_CREDITS, infl[2] === "portrait" ? "Presenter portrait" : "Presenter shot", jobId);
        if (infl[2] === "portrait") {
          const call = await makePortrait(infl[1]).catch(async (e: Error & { call?: DesignUsage }) => {
            if (e.call) await record(jobId, "gemini-portrait", [e.call]);
            await refund(PRESENTER_IMAGE_CREDITS, "Presenter portrait failed", jobId);
            throw e;
          });
          await record(jobId, "gemini-portrait", [call]);
          return json(res, 200, { ok: true, costUsd: call.costUsd });
        }
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
        const product = (await listProducts(String(body.businessId ?? ""))).find((x) => x.id === String(body.productId ?? ""));
        if (!product) return fail(res, 404, "Product not found.");
        const photoId = String(body.photoId ?? product.photos[0]?.assetId ?? "");
        if (!photoId) return fail(res, 400, "This product has no photo for the presenter to hold.");
        const photo = await photoJpeg(photoId, 1280, String(body.businessId));
        const out = await makeShot(infl[1], { name: product.name, photo: photo.bytes }, String(body.action ?? "holding"), typeof body.setting === "string" ? body.setting : null, isRatio(body.ratio) && ["9:16", "3:4", "1:1", "4:3", "16:9"].includes(body.ratio) ? body.ratio : "9:16").catch(async (e: Error & { call?: DesignUsage }) => {
          if (e.call) await record(jobId, "gemini-shot", [e.call]);
          await refund(PRESENTER_IMAGE_CREDITS, "Presenter shot failed", jobId);
          throw e;
        });
        await record(jobId, "gemini-shot", [out.call]);
        return json(res, 200, { uploadId: out.uploadId, costUsd: out.call.costUsd });
      }
    }
    if (req.method === "GET" && p === "/api/blender/status") return json(res, 200, { available: await blenderAvailable(), credits: { ...PREMIUM_3D_CREDITS, rerender: PREMIUM_RERENDER_CREDITS }, sound: BLENDER_MIXES_AUDIO, voiceReady: !!process.env.ELEVENLABS_API_KEY, voiceCredits: VOICE_OVER_CREDITS });
    if (req.method === "POST" && p === "/api/blender/render") {
      // Premium 3D: Claude designs a Blender scene from the same brief as a Motion video, then Blender renders it here.
      if (!(await blenderAvailable())) return fail(res, 503, "Premium 3D needs Blender on the studio computer, and it is not installed.");
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const reqd = await readRequest({ ...body, mode: "reference" });
      if ("error" in reqd) return fail(res, reqd.status, reqd.error);
      if (claudeMode() === "api") {
        const spent = await spentToday();
        if (spent + maxDesignCost(reqd.photoIds.length) > DAILY_CAP_USD) return fail(res, 429, `Today's test budget is used: $${spent.toFixed(2)} of $${DAILY_CAP_USD.toFixed(2)}. More tomorrow (Kigali time).`);
      }
      const { brief, files } = await briefFor(reqd, null);
      const product = (await listProducts(reqd.businessId)).find((x) => x.id === reqd.productId);
      try {
        const job = await startPremium3d({ brief, files, send: claudeMode() === "api" ? apiTransport(process.env.ANTHROPIC_API_KEY as string) : subscriptionTransport(), model: process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL, meta: { businessId: reqd.businessId, productId: reqd.productId, title: product?.name ?? "Premium 3D" }, voice: body.voice !== false && !!process.env.ELEVENLABS_API_KEY, music: body.music !== false, quality: isPremiumQuality(body.quality) ? body.quality : "540p" });
        return json(res, 200, { job });
      } catch (error) {
        return fail(res, 402, error instanceof Error ? error.message : "Not enough credits.");
      }
    }
    if (req.method === "GET" && p === "/api/blender/jobs") return json(res, 200, { jobs: await listPremiumJobs() });
    const blRe = p.match(/^\/api\/blender\/jobs\/(bl-[0-9a-f]{12})\/rerender$/);
    if (req.method === "POST" && blRe) {
      // The same scene rendered again (no new design), at 540p or 720p.
      if (!(await blenderAvailable())) return fail(res, 503, "Premium 3D needs Blender on the studio computer, and it is not installed.");
      const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}");
      try {
        const sound = { voice: body.voice === true && !!process.env.ELEVENLABS_API_KEY, music: body.music === true };
        return json(res, 200, { job: await rerenderPremium(blRe[1], isPremiumQuality(body.quality) ? body.quality : "720p", sound) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "It could not be rendered again.";
        return fail(res, /credits/i.test(message) ? 402 : 400, message);
      }
    }
    const blJob = p.match(/^\/api\/blender\/jobs\/(bl-[0-9a-f]{12})$/);
    if (req.method === "GET" && blJob) {
      const j = await getPremiumJob(blJob[1]);
      return j ? json(res, 200, j) : fail(res, 404, "Not found");
    }
    const blVideo = p.match(/^\/videos\/blender\/(bl-[0-9a-f]{12})\.mp4$/);
    if (req.method === "GET" && blVideo) {
      const bytes = await premiumVideoBytes(blVideo[1]);
      return bytes ? sendMedia(req, res, bytes, "video/mp4", { "content-disposition": `inline; filename="bupulse-${blVideo[1]}.mp4"` }) : fail(res, 404, "Not found");
    }
    if (req.method === "GET" && p === "/api/hooks") {
      // The Brain's three opening lines for this product, template and platform (lib/video-engine/brain/suggest.ts).
      const q = Object.fromEntries(url.searchParams);
      const reqd = await readRequest({ businessId: q.business, productId: q.product, styleId: q.template, seconds: Number(q.seconds) || 15, platform: q.platform, mode: "text", purpose: q.purpose });
      if ("error" in reqd) return fail(res, reqd.status, reqd.error);
      const { brief } = await briefFor(reqd, null, { photos: false });
      // The Brain calls YouTube Shorts "shorts".
      return json(res, 200, { hooks: suggestHooks(brief, { platform: reqd.platform === "youtube" ? "shorts" : (reqd.platform ?? "any") }) });
    }
    if (req.method === "GET" && p === "/api/first-comment") {
      // The seller's pinned first comment for a product (price, place, delivery, WhatsApp; or the Kinyarwanda reply kit).
      const q = Object.fromEntries(url.searchParams);
      const reqd = await readRequest({ businessId: q.business, productId: q.product, mode: "text" });
      if ("error" in reqd) return fail(res, reqd.status, reqd.error);
      const { brief } = await briefFor(reqd, null, { photos: false });
      return json(res, 200, { comment: firstCommentFor(brief) });
    }
    if (req.method === "GET" && p === "/api/plan") {
      // "Plan a week": seven distinct posts for this product (the Brain's planSeries; free, no AI). Each row is then
      // generated as a normal Motion design.
      const q = Object.fromEntries(url.searchParams);
      const reqd = await readRequest({ businessId: q.business, productId: q.product, styleId: q.template, seconds: Number(q.seconds) || 15, platform: q.platform, mode: "text", purpose: q.purpose });
      if ("error" in reqd) return fail(res, reqd.status, reqd.error);
      const { brief } = await briefFor(reqd, null, { photos: false });
      const today = kigaliDay();
      const posts = planSeries(brief, { platform: reqd.platform === "youtube" ? "shorts" : (reqd.platform ?? "any"), count: 7, presenter: q.presenter === "1", businessId: reqd.businessId, startDay: today });
      // The page speaks designer.ts's platform keys: the Brain's "shorts" is YouTube.
      return json(res, 200, { posts: posts.map((x) => ({ ...x, platform: x.platform === "shorts" ? "youtube" : x.platform })) });
    }
    if (req.method === "GET" && p === "/api/images") return json(res, 200, { images: (await listImages()).map((i) => ({ ...i, url: `/api/photo/${i.id}` })) });
    if (req.method === "POST" && p === "/api/image") {
      // The AI image page (Nano Banana): a prompt and up to 3 reference photos. Charged like a presenter image,
      // taken first and given back when Gemini fails; the image is saved as an upload so videos can use it.
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const prompt = String(body.prompt ?? "").trim().slice(0, 1500);
      if (!prompt) return fail(res, 400, "Describe the image first.");
      const ratio = (IMAGE_RATIOS as readonly string[]).includes(body.ratio) ? String(body.ratio) : "1:1";
      const businessId = String(body.businessId ?? "");
      const refs = (Array.isArray(body.refs) ? body.refs : []).map(String).slice(0, 3);
      const references: Buffer[] = [];
      for (const r of refs) {
        const [kind, id] = r.split(":");
        if (kind !== "ph" && kind !== "up") continue;
        references.push((await photoJpeg(id, 1280, kind === "ph" ? businessId : undefined)).bytes);
      }
      const spent = await spentToday();
      if (spent + 0.05 > DAILY_CAP_USD) return fail(res, 429, `Today's test budget is used: $${spent.toFixed(2)} of $${DAILY_CAP_USD.toFixed(2)}.`);
      const jobId = newJobId();
      try {
        await charge(PRESENTER_IMAGE_CREDITS, "AI image (Nano Banana)", jobId);
      } catch (error) {
        return fail(res, 402, error instanceof Error ? error.message : "Not enough credits.");
      }
      let made: Awaited<ReturnType<typeof generateImage>>;
      try {
        made = await generateImage(prompt, references, ratio);
      } catch (error) {
        const call = (error as { call?: DesignUsage }).call;
        if (call) await record(jobId, "gemini-image", [call]);
        await refund(PRESENTER_IMAGE_CREDITS, "AI image failed", jobId);
        return fail(res, 502, `${error instanceof Error ? error.message : "The image could not be made."} The credits are given back.`);
      }
      await record(jobId, "gemini-image", [made.call]);
      const up = await saveUpload(made.bytes, `AI image (Nano Banana): ${prompt}`);
      const image = { id: up.id, at: new Date().toISOString(), prompt, ratio, references: references.length, costUsd: made.call.costUsd };
      await addImage(image);
      return json(res, 200, { image: { ...image, url: `/api/photo/${up.id}` }, credits: PRESENTER_IMAGE_CREDITS });
    }
    if (req.method === "GET" && p === "/api/template-previews") return json(res, 200, await listPreviews());
    if (req.method === "POST" && p === "/api/template-previews") {
      // Makes one example video per template (or the ids given) for the gallery, two at a time. Long: run it once.
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const ids: string[] = Array.isArray(body.templateIds) && body.templateIds.length ? body.templateIds.map(String) : VIDEO_TEMPLATES.map((t) => t.id);
      const made: string[] = [];
      const failed: string[] = [];
      for (let i = 0; i < ids.length; i += 2) {
        await Promise.all(
          ids.slice(i, i + 2).map(async (templateId) => {
            const t = VIDEO_TEMPLATES.find((x) => x.id === templateId);
            const reqd = await readRequest({ ...body, styleId: templateId, hookId: t?.hook ?? "auto", seconds: t?.seconds ?? 12, mode: "reference" });
            if ("error" in reqd) return void failed.push(templateId);
            const job = await designOne(reqd, null);
            if (job.spec) {
              await savePreview(templateId, { spec: job.spec, photoIds: job.photoIds, jobId: job.id });
              made.push(templateId);
            } else failed.push(templateId);
          }),
        );
        console.log(`[lab] template previews: ${made.length} made, ${failed.length} failed of ${ids.length}`);
      }
      return json(res, 200, { made, failed });
    }
    if (req.method === "POST" && p === "/api/upload") {
      // The owner's own photo (Seedance lets you upload references too): resized, kept in video-lab/data/uploads.
      const bytes = await readBody(req, 15 * 1024 * 1024);
      return json(res, 200, await saveUpload(bytes));
    }
    if (req.method === "GET" && p === "/api/music") return json(res, 200, await musicFor(url.searchParams.get("mood")));
    const track = p.match(/^\/api\/music\/([A-Za-z0-9_-]{6,60})$/);
    if (req.method === "GET" && track) {
      const t = await musicBytes(track[1]);
      res.writeHead(200, { "content-type": t.mimeType, "cache-control": "max-age=3600" });
      return res.end(t.bytes);
    }
    if (req.method === "POST" && p === "/api/design") {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const out = await design(body);
      return json(res, out.status, out.body);
    }
    if (req.method === "POST" && p === "/api/sample") {
      // The hand-made sample design with this product's photos: checks drawing and MP4 export without any AI cost.
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const business = await getBusiness(String(body.businessId ?? ""));
      const product = business ? (await listProducts(business.id)).find((x) => x.id === String(body.productId ?? "")) : undefined;
      if (!business || !product) return fail(res, 404, "Product not found.");
      const photoIds = product.photos.slice(0, MAX_PHOTOS).map((x) => x.assetId);
      const spec = validateSpec(sampleSpec({ business: business.name, product: product.name, price: product.price, photoCount: photoIds.length }), { ratio: "9:16", photoCount: photoIds.length, seconds: 12 });
      const job: LabJob = { id: newJobId(), createdAt: new Date().toISOString(), engine: "claude", businessId: business.id, businessName: business.name, productId: product.id, productName: product.name, styleId: "sample", hookId: "none", ratio: "9:16", seconds: 12, note: null, photoIds, spec, usage: [], costUsd: 0, status: "designed", error: null, video: null, edited: false };
      await saveJob(job);
      return json(res, 200, job);
    }
    if (req.method === "GET" && p === "/api/jobs") return json(res, 200, { jobs: await listJobs(), spentUsd: await spentToday(), capUsd: DAILY_CAP_USD });
    const voiceFile = p.match(VOICE_ROUTE);
    if (req.method === "GET" && voiceFile) {
      const bytes = await readVoiceMp3(voiceFile[1]);
      return bytes ? sendMedia(req, res, bytes, "audio/mpeg") : fail(res, 404, "Not found");
    }
    const jobMatch = p.match(/^\/api\/jobs\/([0-9]{8}-[0-9a-f]{8})(\/video|\/spec|\/voice|\/reshape)?$/);
    if (jobMatch) {
      const job = await getJob(jobMatch[1]);
      if (!job) return fail(res, 404, "Test not found.");
      if (req.method === "GET" && !jobMatch[2]) return json(res, 200, job);
      if (req.method === "PUT" && jobMatch[2] === "/spec") {
        // The owner edited the design by hand: checked like Claude's answer, no AI call, no cost.
        const raw = JSON.parse((await readBody(req, 512 * 1024)).toString("utf8"));
        job.spec = validateSpec(raw, { ratio: isRatio(raw?.ratio) ? raw.ratio : (job.ratio as "9:16"), photoCount: job.photoIds.length, seconds: (raw?.scenes ?? []).reduce((s: number, x: { seconds?: number }) => s + (Number(x?.seconds) || 0), 0) || job.seconds });
        job.edited = true;
        await saveJob(job);
        return json(res, 200, job);
      }
      if (req.method === "POST" && jobMatch[2] === "/reshape") {
        // The same design for another network's shape: the validator re-lays it for the new canvas (safe area, no
        // overlaps, the product kept clear). No Claude call and no charge; saved as a child job.
        if (!job.spec) return fail(res, 400, "This design failed, so it has nothing to re-shape.");
        const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}");
        const shape = RESHAPES[String(body.ratio)];
        if (!shape) return fail(res, 400, "Choose 1:1 (Facebook feed) or 4:5 (Instagram feed).");
        const business = await getBusiness(job.businessId);
        const photos = await Promise.all(
          job.photoIds.map(async (id) => {
            const ph = await photoJpeg(id, 1280, id.startsWith("up-") ? undefined : job.businessId);
            const cut = await cutoutForPhoto(id, id.startsWith("up-") ? undefined : job.businessId);
            return { width: ph.width, height: ph.height, subject: cut.ok ? cut.box : null };
          }),
        );
        // The same checks as a new design (designer.ts), except `facts`: a re-shape keeps what the owner wrote.
        const purpose = (job as LabJob & { purpose?: "ad" | "post" }).purpose ?? "ad";
        const spec = validateSpec({ ...job.spec, ratio: body.ratio }, { ratio: body.ratio as Ratio, photoCount: job.photoIds.length, seconds: totalMs(job.spec) / 1000, fixedLens: job.fixedLens, photos, platform: shape.platform, phone: business?.phone ?? null, purpose, productMin: productMinHeight(job.styleId), maxLines: STYLE_LIMITS[templateStyle(job.styleId)].maxLines });
        const parent = job as LabJob & { warnings?: unknown; captionScore?: number; captionMissed?: string[] };
        const child: LabJob & { warnings?: unknown; captionScore?: number; captionMissed?: string[] } = {
          ...parent,
          id: newJobId(),
          createdAt: new Date().toISOString(),
          ratio: body.ratio,
          spec,
          usage: [],
          costUsd: 0,
          apiEquivalentUsd: 0,
          status: "designed",
          error: null,
          video: null,
          edited: false,
          mode: "reshape",
          parentId: job.id,
          version: null,
        };
        await saveJob(child);
        return json(res, 200, child);
      }
      if (req.method === "POST" && jobMatch[2] === "/voice") {
        // The voice-over of a design (ElevenLabs, video-lab/voice.ts). Credits are taken first and given back when it
        // fails, when the design has no voice lines, or when the same take is already saved (a new MP4 of it is free).
        if (!job.spec) return fail(res, 400, "This design failed, so it has no voice lines.");
        const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}");
        try {
          await charge(VOICE_OVER_CREDITS, "Voice-over", job.id);
        } catch (error) {
          return fail(res, 402, error instanceof Error ? error.message : "Not enough credits.");
        }
        try {
          const business = await getBusiness(job.businessId);
          const v = await makeVoiceForJob(job.spec, job.id, { voiceId: typeof body.voiceId === "string" ? body.voiceId : null, language: business?.language ?? null });
          if (!v || v.cached) await refund(VOICE_OVER_CREDITS, v ? "Voice-over already made (free)" : "No voice lines", job.id);
          return json(res, 200, { voice: v, credits: v && !v.cached ? VOICE_OVER_CREDITS : 0 });
        } catch (error) {
          await refund(VOICE_OVER_CREDITS, "Voice-over failed", job.id);
          return fail(res, 502, `${error instanceof Error ? error.message : "The voice-over could not be made."} The credits are given back.`);
        }
      }
      if (req.method === "POST" && jobMatch[2] === "/video") {
        const bytes = await readBody(req, MAX_UPLOAD);
        if (bytes.length < 1000 || bytes.subarray(4, 8).toString("latin1") !== "ftyp") return fail(res, 400, "That is not an MP4 file.");
        await saveVideo(job.id, bytes);
        const q = url.searchParams.get("q");
        job.video = { bytes: bytes.length, renderMs: Number(url.searchParams.get("ms")) || 0, savedAt: new Date().toISOString(), quality: q && q in QUALITIES ? q : "1080p" };
        await saveJob(job);
        return json(res, 200, job);
      }
    }
    const video = p.match(/^\/videos\/([0-9]{8}-[0-9a-f]{8})\.mp4$/);
    if (req.method === "GET" && video) {
      const bytes = await readVideo(video[1]);
      if (!bytes) return fail(res, 404, "Not found");
      return sendMedia(req, res, bytes, "video/mp4", { "content-disposition": `inline; filename="bupulse-${video[1]}.mp4"` });
    }
    if (req.method === "GET" && !p.startsWith("/api/") && (req.headers.accept ?? "").includes("text/html")) {
      // A person on a wrong link gets the studio's 404 page with links, not a bare JSON error.
      const html = await fs.readFile(path.join(PAGES, "notfound.html")).catch(() => null);
      if (html) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }
    }
    fail(res, 404, "Not found");
  } catch (error) {
    // Plain message only: no stack traces or secrets reach the page or the log.
    const message = error instanceof Error ? error.message : "Something went wrong.";
    console.log(`[lab] ${req.method} ${p} failed: ${message}`);
    fail(res, 500, message);
  }
});

// Designs can take minutes (several versions, template previews): no request time limit on this local server.
server.requestTimeout = 0;

const LAB_KEYS = ["ANTHROPIC_API_KEY", "SEEDANCE_API_KEY", "SEEDANCE_MODEL", "SEEDANCE_BASE_URL", "ELEVENLABS_API_KEY", "BYTEPLUS_ACCESS_KEY_ID", "BYTEPLUS_SECRET_ACCESS_KEY", "STUDIO_PUBLIC_URL"];
// An empty value in .env ("") counts as missing, so a key saved in Admin -> Services can fill it.
for (const name of LAB_KEYS) if (!process.env[name]) delete process.env[name];
void loadSavedKeys(LAB_KEYS)
  .catch(() => [] as string[])
  .then((loaded) => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`BuPulse Video Studio: http://localhost:${PORT}  (daily test budget $${DAILY_CAP_USD}; the old lab page is /lab)`);
      void resumeSeedanceJobs();
      void recoverPremiumJobs().then((n) => n && console.log(`[lab] ${n} Premium 3D job(s) stopped by the restart: credits given back.`));
      if (loaded.length) console.log(`Keys from Admin -> Services: ${loaded.join(", ")}`);
      console.log(
        claudeMode() === "subscription"
          ? "Claude: your SUBSCRIPTION (claude CLI), tests only. Before deploying, switch to ANTHROPIC_API_KEY."
          : "Claude: the API key (ANTHROPIC_API_KEY).",
      );
      if (!process.env.SEEDANCE_API_KEY) console.log("Not set: SEEDANCE_API_KEY (add it to .env or Admin -> Services)");
      console.log(process.env.STUDIO_PASSWORD ? "Online access: password gate on (this computer needs no password)." : "Not set: STUDIO_PASSWORD, so online visitors are refused.");
    });
  });
const stop = () => server.close(() => void closeDb().then(() => process.exit(0)));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
