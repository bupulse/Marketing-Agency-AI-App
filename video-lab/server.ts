// BuPulse Video Lab (docs/VIDEO_ENGINE.md): a small local site for testing the video engine, separate from the app.
// Started by `npm run lab` (scripts/video-lab/start.mjs), listens on 127.0.0.1 only. It designs videos with Claude from
// the TEST database's products, keeps every test and its cost, and stores the MP4s the page renders.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { DESIGNER_MODEL, DesignError, apiSum, designVideo, estimateDesignCost, maxDesignCost, type BriefPhoto } from "@/lib/video-engine/designer";
import { subscriptionTransport } from "./claude-cli";
import { VIDEO_HOOKS, VIDEO_STYLES } from "@/lib/video-engine/styles";
import { RATIOS, isRatio, SPEC_LIMITS } from "@/lib/video-engine/spec";
import { validateSpec } from "@/lib/video-engine/validate";
import { sampleSpec } from "@/lib/video-engine/sample";
import { closeDb, getBusiness, loadSavedKeys, listBusinesses, listProducts, musicBytes, musicFor, photoJpeg } from "./data-source";
import { DAILY_CAP_USD, getJob, listJobs, newJobId, readVideo, record, saveJob, saveVideo, spentToday, type LabJob } from "./store";

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

async function design(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const mode = claudeMode();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const businessId = String(body.businessId ?? "");
  const productId = String(body.productId ?? "");
  const ratio = isRatio(body.ratio) ? body.ratio : "9:16";
  const seconds = Math.min(SPEC_LIMITS.maxTotalSeconds, Math.max(SPEC_LIMITS.minTotalSeconds, Number(body.seconds) || 15));
  const styleId = String(body.styleId ?? VIDEO_STYLES[0].id);
  const hookId = String(body.hookId ?? "auto");
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 400) : null;

  const business = await getBusiness(businessId);
  if (!business) return { status: 404, body: { error: "Business not found." } };
  const product = (await listProducts(businessId)).find((p) => p.id === productId);
  if (!product) return { status: 404, body: { error: "Product not found." } };
  const wanted = Array.isArray(body.photoIds) ? body.photoIds.map(String) : product.photos.map((p) => p.assetId);
  const photoIds = wanted.filter((id) => product.photos.some((p) => p.assetId === id)).slice(0, MAX_PHOTOS);

  const spent = await spentToday();
  const worst = maxDesignCost(photoIds.length);
  if (mode === "api" && spent + worst > DAILY_CAP_USD) {
    return { status: 429, body: { error: `Today's test budget is used: $${spent.toFixed(2)} of $${DAILY_CAP_USD.toFixed(2)}. More tomorrow (Kigali time).` } };
  }

  const photos: BriefPhoto[] = [];
  for (const id of photoIds) {
    const p = await photoJpeg(id, 1280, businessId);
    const meta = product.photos.find((x) => x.assetId === id);
    photos.push({ base64: p.bytes.toString("base64"), mediaType: "image/jpeg", width: p.width, height: p.height, note: meta?.description ?? undefined });
  }

  const job: LabJob = {
    id: newJobId(),
    createdAt: new Date().toISOString(),
    engine: "claude",
    businessId,
    businessName: business.name,
    productId,
    productName: product.name,
    styleId,
    hookId,
    ratio,
    seconds,
    note,
    photoIds,
    spec: null,
    usage: [],
    costUsd: 0,
    status: "designed",
    error: null,
    video: null,
    edited: false,
  };
  try {
    const result = await designVideo(
      {
        business: { name: business.name, description: business.description, language: business.language, colors: business.colors, phone: business.phone, website: business.website, country: business.country, tone: business.tone },
        product: { name: product.name, summary: product.summary, description: product.description, price: product.price, usps: product.usps, features: product.features, targetCustomer: product.targetCustomer },
        photos,
        styleId,
        hookId,
        ratio,
        seconds,
        note,
      },
      mode === "api" ? { apiKey, model: process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL } : { transport: subscriptionTransport(), model: process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL },
    );
    await record(job.id, "claude-design", result.usage);
    Object.assign(job, { spec: result.spec, usage: result.usage, costUsd: result.costUsd, apiEquivalentUsd: result.apiEquivalentUsd, billedTo: mode });
  } catch (error) {
    const usage = error instanceof DesignError ? error.usage : [];
    await record(job.id, "claude-design", usage);
    Object.assign(job, { status: "failed", usage, costUsd: usage.reduce((s, u) => s + u.costUsd, 0), apiEquivalentUsd: apiSum(usage), billedTo: mode, error: error instanceof Error ? error.message : "Design failed." });
  }
  await saveJob(job);
  return { status: job.status === "failed" ? 502 : 200, body: job };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  try {
    if (req.method === "GET" && (p === "/" || p === "/index.html")) return file(res, path.join(BUILD, "index.html"), "text/html; charset=utf-8");
    if (req.method === "GET" && p === "/app.js") return file(res, path.join(BUILD, "app.js"), "text/javascript; charset=utf-8");
    if (req.method === "GET" && p.startsWith("/fonts/video/")) {
      const name = path.basename(p);
      if (!/^[a-z0-9-]+\.woff2$/.test(name)) return fail(res, 404, "Not found");
      return file(res, path.join(FONTS, name), "font/woff2", "max-age=86400");
    }
    if (req.method === "GET" && p === "/api/options") {
      return json(res, 200, {
        styles: VIDEO_STYLES.map(({ id, name, blurb }) => ({ id, name, blurb })),
        hooks: VIDEO_HOOKS.map(({ id, name }) => ({ id, name })),
        ratios: Object.keys(RATIOS),
        model: process.env.VIDEO_LAB_MODEL || DESIGNER_MODEL,
        capUsd: DAILY_CAP_USD,
        spentUsd: await spentToday(),
        estimateUsd: [0, 1, 2, 3, 4].map((n) => estimateDesignCost(n)),
        seedanceReady: !!process.env.SEEDANCE_API_KEY,
        claudeReady: true,
        claudeMode: claudeMode(),
      });
    }
    if (req.method === "GET" && p === "/api/businesses") return json(res, 200, await listBusinesses());
    if (req.method === "GET" && p === "/api/products") return json(res, 200, await listProducts(url.searchParams.get("business") ?? ""));
    const photo = p.match(/^\/api\/photo\/([A-Za-z0-9-]{10,40})$/);
    if (req.method === "GET" && photo) {
      const size = url.searchParams.get("size") === "thumb" ? 360 : 1600;
      const out = await photoJpeg(photo[1], size);
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=3600" });
      return res.end(out.bytes);
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
        job.video = { bytes: bytes.length, renderMs: Number(url.searchParams.get("ms")) || 0, savedAt: new Date().toISOString() };
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

const LAB_KEYS = ["ANTHROPIC_API_KEY", "SEEDANCE_API_KEY", "SEEDANCE_MODEL", "SEEDANCE_BASE_URL"];
// An empty value in .env ("") counts as missing, so a key saved in Admin -> Services can fill it.
for (const name of LAB_KEYS) if (!process.env[name]) delete process.env[name];
void loadSavedKeys(LAB_KEYS)
  .catch(() => [] as string[])
  .then((loaded) => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`BuPulse Video Lab: http://localhost:${PORT}  (daily test budget $${DAILY_CAP_USD})`);
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
