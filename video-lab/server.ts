// BuPulse Video Lab (docs/VIDEO_ENGINE.md): a small local site for testing the video engine, separate from the app.
// Started by `npm run lab` (scripts/video-lab/start.mjs), listens on 127.0.0.1 only. It designs videos with Claude from
// the TEST database's products, keeps every test and its cost, and stores the MP4s the page renders.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { DESIGNER_MODEL, DESIGN_MODES, DesignError, apiSum, apiTransport, designVideo, estimateDesignCost, maxDesignCost, type BriefPhoto, type DesignMode, type DesignUsage } from "@/lib/video-engine/designer";
import { subscriptionTransport } from "./claude-cli";
import { VIDEO_HOOKS } from "@/lib/video-engine/styles";
import { TEMPLATE_CATEGORIES, VIDEO_TEMPLATES } from "@/lib/video-engine/templates";
import { CARTOON_CAST, castById } from "@/lib/video-engine/cast";
import { CAMERA_MOVES, GRADES, QUALITIES, RATIOS, isRatio, SPEC_LIMITS, totalMs, type MotionSpec, type Ratio } from "@/lib/video-engine/spec";
import { validateSpec } from "@/lib/video-engine/validate";
import { sampleSpec } from "@/lib/video-engine/sample";
import { closeDb, getBusiness, loadSavedKeys, listBusinesses, listProducts, musicBytes, musicFor, photoJpeg, saveUpload, uploadExists, uploadNote } from "./data-source";
import { INFLUENCERS, SHOT_ACTIONS, listInfluencers, makePortrait, makeShot, portraitBytes } from "./influencers";
import { DAILY_CAP_USD, getJob, listJobs, listPreviews, newJobId, readVideo, record, savePreview, saveJob, saveVideo, spentToday, type LabJob } from "./store";
import { SEEDANCE_LIMITS, SEEDANCE_MODELS, SEEDANCE_RATIOS, SEEDANCE_RESOLUTIONS, estimateSeedanceUsd, type SeedanceReference, type SeedanceRequest, type SeedanceResolution, type SeedanceTier } from "@/lib/video-engine/seedance";
import { writeSeedancePrompt } from "@/lib/video-engine/seedance-prompt";
import { CLAUDE_VIDEO_CREDITS, CREDIT_PACKS, PRESENTER_IMAGE_CREDITS, charge, readWallet, refund, seedanceCredits, topUp } from "./credits";
import { cancelSeedance, getSeedanceJob, imageDataUrl, listSeedanceJobs, resumeSeedanceJobs, seedanceReady, seedanceVideoBytes, submitSeedance } from "./seedance-jobs";
import { mediaBytes, saveMedia } from "./data-source";

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
 * How the lab reaches Claude. "subscription" (the owner's Claude Code login, tests only) when there is no API key or
 * VIDEO_LAB_CLAUDE=subscription; "api" otherwise. Before deploying anything, switch to the API key (docs/VIDEO_ENGINE.md).
 */
const claudeMode = (): "api" | "subscription" => (process.env.VIDEO_LAB_CLAUDE === "subscription" || !process.env.ANTHROPIC_API_KEY ? "subscription" : "api");

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
};

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
  };
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
    const photos: BriefPhoto[] = [];
    for (const id of req.photoIds) {
      const p = await photoJpeg(id, 1280, req.businessId);
      const meta = product.photos.find((x) => x.assetId === id);
      const note = meta?.description ?? (id.startsWith("up-") ? ((await uploadNote(id)) ?? "uploaded by the owner") : undefined);
      photos.push({ base64: p.bytes.toString("base64"), mediaType: "image/jpeg", width: p.width, height: p.height, note });
    }
    const result = await designVideo(
      {
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
      },
      mode === "api" ? { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL } : { transport: subscriptionTransport(), model: process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL },
    );
    await record(job.id, "claude-design", result.usage);
    Object.assign(job, { spec: result.spec, usage: result.usage, costUsd: result.costUsd, apiEquivalentUsd: result.apiEquivalentUsd, billedTo: mode });
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
const PAGE_ROUTES: Record<string, string> = { "/": "home", "/create": "create", "/showcase": "showcase", "/videos": "videos", "/pricing": "pricing", "/guide": "guide" };
const REDIRECTS: Record<string, string> = { "/app/video/seedance": "/create", "/app/video/motion": "/create?engine=claude", "/templates": "/create#tgrid", "/app": "/create" };

const labelFor = (r: { kind: string; label?: unknown }, n: number) => `${r.kind === "image" ? "Image" : r.kind === "video" ? "Video" : "Audio"} ${n}: ${typeof r.label === "string" ? r.label.slice(0, 120) : r.kind}`;

/** Turns the page's reference ids (ph:<asset>, up:<upload>, um:<media>, vid:<engine>:<job>) into BytePlus data URLs. */
async function resolveReferences(refs: { id: string; kind: string; role?: string }[], businessId: string): Promise<{ references: SeedanceReference[]; notes: string[] }> {
  const references: SeedanceReference[] = [];
  const notes: string[] = [];
  const counts = { image: 0, video: 0, audio: 0 };
  for (const r of refs.slice(0, 15)) {
    const [kind, a, b] = r.id.split(":");
    if (r.kind === "image" && (kind === "ph" || kind === "up")) {
      if (counts.image >= SEEDANCE_LIMITS.maxImages) continue;
      const photo = await photoJpeg(a, 1600, kind === "ph" ? businessId : undefined);
      const role = r.role === "first_frame" || r.role === "last_frame" ? r.role : "reference_image";
      references.push({ kind: "image", url: await imageDataUrl(photo.bytes), role });
      counts.image += 1;
      notes.push(labelFor(r, counts.image));
    } else if (r.kind === "video" || r.kind === "audio") {
      let bytes: Buffer | null = null;
      let mime = r.kind === "video" ? "video/mp4" : "audio/mpeg";
      if (kind === "um") {
        const m = await mediaBytes(a);
        bytes = m?.bytes ?? null;
        mime = m?.mimeType ?? mime;
      } else if (kind === "vid") bytes = a === "seedance" ? await seedanceVideoBytes(b) : await readVideo(b);
      if (!bytes) continue;
      if (bytes.length > 40 * 1024 * 1024) throw new Error("A reference video or audio file must be under 40 MB.");
      if (r.kind === "video" && counts.video >= SEEDANCE_LIMITS.maxVideos) continue;
      if (r.kind === "audio" && counts.audio >= SEEDANCE_LIMITS.maxAudio) continue;
      references.push({ kind: r.kind, url: `data:${mime};base64,${bytes.toString("base64")}` });
      counts[r.kind] += 1;
      notes.push(labelFor(r, counts[r.kind]));
    }
  }
  return { references, notes };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  try {
    if (req.method === "GET" && PAGE_ROUTES[p]) return file(res, path.join(PAGES, `${PAGE_ROUTES[p]}.html`), "text/html; charset=utf-8");
    if (req.method === "GET" && REDIRECTS[p]) {
      res.writeHead(302, { location: REDIRECTS[p] });
      return res.end();
    }
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
      return json(res, 200, { credits: CLAUDE_VIDEO_CREDITS * versions, usd: estimateDesignCost(Math.min(4, Number(body.photos) || 0)) * versions });
    }
    if (req.method === "GET" && p === "/api/showcase") {
      const [cl, sd] = await Promise.all([listJobs(), listSeedanceJobs()]);
      const items = [
        ...sd.map((j) => ({ id: j.id, engine: "seedance", title: j.title, createdAt: j.createdAt, status: j.status, videoUrl: j.videoFile ? `/videos/seedance/${j.id}.mp4` : null, prompt: j.request.prompt, info: { Quality: `${j.request.tier} · ${j.request.resolution} · ${j.request.seconds} s`, Credits: String(j.credits), "Provider cost": j.costUsd ? `$${j.costUsd.toFixed(3)}` : `about $${j.estimateUsd.toFixed(2)}` } })),
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
      res.writeHead(200, { "content-type": m.mimeType });
      return res.end(m.bytes);
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
      return json(res, 200, { prompt: out.prompt });
    }
    if (req.method === "POST" && p === "/api/seedance/submit") {
      if (!seedanceReady()) return fail(res, 503, "Seedance is waiting for the BytePlus key (SEEDANCE_API_KEY in .env).");
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const prompt = String(body.prompt ?? "").trim();
      if (!prompt) return fail(res, 400, "Write a prompt first.");
      const tier = (body.tier in SEEDANCE_MODELS ? body.tier : "fast") as SeedanceTier;
      const allowed = SEEDANCE_MODELS[tier].resolutions as readonly string[];
      const resolution = (allowed.includes(body.resolution) ? body.resolution : allowed[allowed.length - 1]) as SeedanceResolution;
      const ratio = (SEEDANCE_RATIOS as readonly string[]).includes(body.ratio) ? body.ratio : "9:16";
      const seconds = Math.min(SEEDANCE_LIMITS.maxSeconds, Math.max(SEEDANCE_LIMITS.minSeconds, Math.round(Number(body.seconds) || 5)));
      const versions = Math.min(3, Math.max(1, Number(body.versions) || 1));
      const businessId = String(body.businessId ?? "");
      const product = businessId ? (await listProducts(businessId)).find((x) => x.id === String(body.productId ?? "")) : undefined;
      const { references, notes } = await resolveReferences(Array.isArray(body.refs) ? body.refs : [], businessId);
      const request: SeedanceRequest = { tier, prompt, references, ratio, seconds, resolution, audio: body.audio !== false, fixedLens: body.fixedLens === true, seed: Number.isFinite(Number(body.seed)) && body.seed !== null && body.seed !== "" ? Number(body.seed) : null, flex: body.flex === true, draft: body.draft === true };
      const jobs = [];
      for (let i = 0; i < versions; i++) {
        jobs.push(await submitSeedance({ ...request, seed: i === 0 ? request.seed : null }, { businessId: businessId || null, productId: product?.id ?? null, title: product?.name ?? prompt.slice(0, 40), referenceNotes: notes }));
      }
      return json(res, 200, { jobs });
    }
    if (req.method === "GET" && p === "/api/seedance/jobs") return json(res, 200, { jobs: await listSeedanceJobs() });
    const sdJob = p.match(/^\/api\/seedance\/jobs\/(sd-[0-9a-f]{12})(\/cancel)?$/);
    if (sdJob) {
      if (req.method === "GET" && !sdJob[2]) {
        const j = await getSeedanceJob(sdJob[1]);
        return j ? json(res, 200, j) : fail(res, 404, "Not found");
      }
      if (req.method === "POST" && sdJob[2]) {
        const j = await cancelSeedance(sdJob[1]);
        return j ? json(res, 200, j) : fail(res, 404, "Not found");
      }
    }
    const sdVideo = p.match(/^\/videos\/seedance\/(sd-[0-9a-f]{12})\.mp4$/);
    if (req.method === "GET" && sdVideo) {
      const bytes = await seedanceVideoBytes(sdVideo[1]);
      if (!bytes) return fail(res, 404, "Not found");
      res.writeHead(200, { "content-type": "video/mp4", "content-disposition": `inline; filename="bupulse-${sdVideo[1]}.mp4"` });
      return res.end(bytes);
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
        seedanceReady: !!process.env.SEEDANCE_API_KEY,
        seedance: { tiers: (Object.keys(SEEDANCE_MODELS) as SeedanceTier[]).map((tier) => ({ ...SEEDANCE_MODELS[tier], id: tier, model: SEEDANCE_MODELS[tier].id })), ratios: SEEDANCE_RATIOS, limits: { minSeconds: SEEDANCE_LIMITS.minSeconds, maxSeconds: SEEDANCE_LIMITS.maxSeconds } },
        claudeReady: true,
        claudeMode: claudeMode(),
      });
    }
    if (req.method === "GET" && p === "/api/businesses") return json(res, 200, await listBusinesses());
    if (req.method === "GET" && p === "/api/products") return json(res, 200, await listProducts(url.searchParams.get("business") ?? ""));
    const photo = p.match(/^\/api\/photo\/([A-Za-z0-9-]{8,40})$/);
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
    const jobMatch = p.match(/^\/api\/jobs\/([0-9]{8}-[0-9a-f]{8})(\/video|\/spec)?$/);
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
      res.writeHead(200, { "content-type": "video/mp4", "content-disposition": `inline; filename="bupulse-${video[1]}.mp4"` });
      return res.end(bytes);
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

const LAB_KEYS = ["ANTHROPIC_API_KEY", "SEEDANCE_API_KEY", "SEEDANCE_MODEL", "SEEDANCE_BASE_URL"];
// An empty value in .env ("") counts as missing, so a key saved in Admin -> Services can fill it.
for (const name of LAB_KEYS) if (!process.env[name]) delete process.env[name];
void loadSavedKeys(LAB_KEYS)
  .catch(() => [] as string[])
  .then((loaded) => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`BuPulse Video Studio: http://localhost:${PORT}  (daily test budget $${DAILY_CAP_USD}; the old lab page is /lab)`);
      void resumeSeedanceJobs();
      if (loaded.length) console.log(`Keys from Admin -> Services: ${loaded.join(", ")}`);
      console.log(
        claudeMode() === "subscription"
          ? "Claude: your SUBSCRIPTION (claude CLI), tests only. Before deploying, switch to ANTHROPIC_API_KEY."
          : "Claude: the API key (ANTHROPIC_API_KEY).",
      );
      if (!process.env.SEEDANCE_API_KEY) console.log("Not set: SEEDANCE_API_KEY (add it to .env or Admin -> Services)");
    });
  });
const stop = () => server.close(() => void closeDb().then(() => process.exit(0)));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
