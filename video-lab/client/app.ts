// Video Lab page (docs/VIDEO_ENGINE.md). Plain DOM, no framework. Draws the live preview with the engine's own
// renderer (lib/video-engine/draw.ts) and makes the MP4 in this browser (encode.ts), then uploads it to the lab server.
import { drawSpecFrame, type Img } from "@/lib/video-engine/draw";
import { encodeSpecMp4, loadPhotos, loadSpecFonts } from "@/lib/video-engine/encode";
import { canvasSize, totalMs, type MotionSpec } from "@/lib/video-engine/spec";

type Photo = { assetId: string; width: number | null; height: number | null; description: string | null };
type Product = { id: string; name: string; summary: string; price: string | null; photos: Photo[] };
type Job = {
  id: string;
  createdAt: string;
  businessId: string;
  businessName: string;
  productId: string;
  productName: string;
  styleId: string;
  ratio: string;
  seconds: number;
  photoIds: string[];
  spec: MotionSpec | null;
  usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number }[];
  costUsd: number;
  apiEquivalentUsd?: number;
  billedTo?: "api" | "subscription";
  status: "designed" | "failed";
  error: string | null;
  video: { bytes: number; renderMs: number } | null;
  edited: boolean;
};
type Options = { styles: { id: string; name: string; blurb: string }[]; hooks: { id: string; name: string }[]; ratios: string[]; model: string; capUsd: number; spentUsd: number; estimateUsd: number[]; seedanceReady: boolean; claudeReady: boolean; claudeMode: "api" | "subscription" };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const api = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
};
const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);

const state = {
  options: null as Options | null,
  products: [] as Product[],
  photoIds: new Set<string>(),
  styleId: "product-hero",
  ratio: "9:16",
  seconds: 15,
  job: null as Job | null,
  photos: new Map<number, Img>(),
  musicUrl: null as string | null,
  musicOn: true,
  playing: false,
  t: 0,
  last: 0,
};

const canvas = $<HTMLCanvasElement>("preview");
const ctx = canvas.getContext("2d")!;

function status(text: string, kind: "" | "err" | "ok" = "") {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${kind}`;
}

function draw() {
  const spec = state.job?.spec;
  if (!spec) {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  drawSpecFrame(ctx, spec, state.photos, state.t);
  const total = totalMs(spec);
  ($<HTMLInputElement>("scrub")).value = String(Math.round((state.t / total) * 1000));
  $("time").textContent = `${(state.t / 1000).toFixed(1)} / ${(total / 1000).toFixed(1)} s`;
}

function tick(now: number) {
  if (!state.playing || !state.job?.spec) return;
  const total = totalMs(state.job.spec);
  state.t += now - state.last;
  state.last = now;
  if (state.t >= total) state.t = 0;
  draw();
  requestAnimationFrame(tick);
}

function play(on: boolean) {
  state.playing = on && !!state.job?.spec;
  $("play").textContent = state.playing ? "Pause" : "Play";
  if (state.playing) {
    state.last = performance.now();
    requestAnimationFrame(tick);
  }
}

async function loadJob(job: Job) {
  play(false);
  state.job = job;
  renderSide();
  renderJobs();
  $<HTMLButtonElement>("export").disabled = !job.spec;
  $<HTMLButtonElement>("apply").disabled = !job.spec;
  const dl = $<HTMLAnchorElement>("download");
  dl.hidden = !job.video;
  if (job.video) {
    dl.href = `/videos/${job.id}.mp4`;
    dl.download = `bupulse-${job.id}.mp4`;
  }
  if (!job.spec) {
    status(job.error || "This test failed.", "err");
    draw();
    return;
  }
  const { width, height } = canvasSize(job.spec);
  canvas.width = width;
  canvas.height = height;
  status("Loading photos and fonts…");
  const [photos] = await Promise.all([loadPhotos(job.photoIds.map((id) => `/api/photo/${id}`)), loadSpecFonts(job.spec)]);
  state.photos = photos;
  const track = job.spec.music ? await api<{ id: string; title: string } | null>(`/api/music?mood=${encodeURIComponent(job.spec.music)}`).catch(() => null) : null;
  state.musicUrl = track ? `/api/music/${track.id}` : null;
  $("music").textContent = track ? `Music: ${state.musicOn ? track.title : "off"}` : "Music: none";
  state.t = 0;
  draw();
  status(job.edited ? "Your edited design. Press Play, or Make MP4." : job.usage.length ? "Designed by Claude. Press Play, or Make MP4." : "Sample design (no AI). Press Play, or Make MP4.", "ok");
  play(true);
}

function renderSide() {
  const job = state.job;
  const spec = job?.spec;
  $("caption").textContent = spec?.caption || "—";
  $("hashtags").textContent = spec?.hashtags.map((h) => `#${h}`).join(" ") ?? "";
  ($<HTMLTextAreaElement>("json")).value = spec ? JSON.stringify(spec, null, 2) : "";
  const rows: [string, string][] = job
    ? [
        ["Engine", job.usage.length ? "Claude-designed" : "Sample design (no AI)"],
        ["Model", job.usage[0]?.model ?? "—"],
        ["Claude calls", String(job.usage.length)],
        ["Tokens in / out", job.usage.map((u) => `${u.inputTokens.toLocaleString()} / ${u.outputTokens.toLocaleString()}`).join(" + ") || "—"],
        ["Claude reached by", job.usage.length ? (job.billedTo === "subscription" ? "your subscription (tests only)" : "API key") : "—"],
        ["Claude cost", usd(job.costUsd)],
        ["Same on the API", usd(job.apiEquivalentUsd ?? job.costUsd)],
        ["Rendering", "free (this browser)"],
        ["Video", job.video ? `${(job.video.bytes / 1024 / 1024).toFixed(1)} MB, made in ${(job.video.renderMs / 1000).toFixed(0)} s` : "not made yet"],
        ["Length", spec ? `${(totalMs(spec) / 1000).toFixed(1)} s, ${spec.scenes.length} scenes` : "—"],
        ["Total for this video", usd(job.costUsd)],
      ]
    : [["Nothing yet", ""]];
  $("cost").replaceChildren();
  for (const [k, v] of rows) {
    const a = document.createElement("span");
    a.className = "k";
    a.textContent = k;
    const b = document.createElement("span");
    b.textContent = v;
    $("cost").append(a, b);
  }
}

async function refreshSpend() {
  const data = await api<{ jobs: Job[]; spentUsd: number; capUsd: number }>("/api/jobs");
  const pct = Math.min(100, (data.spentUsd / data.capUsd) * 100);
  const spend = $("spend");
  const amount = document.createElement("b");
  amount.textContent = usd(data.spentUsd);
  const bar = document.createElement("span");
  bar.className = "bar";
  const fill = document.createElement("i");
  fill.style.width = `${pct}%`;
  bar.append(fill);
  spend.replaceChildren("Today: ", amount, ` of $${data.capUsd.toFixed(2)}`, bar);
  jobsCache = data.jobs;
  renderJobs();
}

let jobsCache: Job[] = [];
function renderJobs() {
  const list = $("jobs");
  list.replaceChildren();
  for (const j of jobsCache) {
    const b = document.createElement("button");
    b.className = `job${j.status === "failed" ? " failed" : ""}${state.job?.id === j.id ? " active" : ""}`;
    const title = document.createElement("b");
    title.textContent = j.productName;
    const cost = document.createElement("span");
    cost.textContent = j.billedTo === "subscription" ? `$0 · API ${usd(j.apiEquivalentUsd ?? 0)}` : usd(j.costUsd);
    const meta = document.createElement("small");
    meta.textContent = `${new Date(j.createdAt).toLocaleString()} · ${j.styleId} · ${j.ratio} · ${j.seconds}s${j.video ? " · MP4" : ""}${j.status === "failed" ? " · failed" : ""}`;
    b.append(title, cost, meta);
    b.onclick = async () => loadJob(await api<Job>(`/api/jobs/${j.id}`));
    list.append(b);
  }
  if (!jobsCache.length) list.textContent = "No tests yet.";
}

function chips(containerId: string, values: string[], current: () => string, set: (v: string) => void, label = (v: string) => v) {
  const box = $(containerId);
  box.replaceChildren();
  for (const v of values) {
    const b = document.createElement("button");
    b.textContent = label(v);
    b.className = current() === v ? "on" : "";
    b.onclick = () => {
      set(v);
      chips(containerId, values, current, set, label);
      updateEstimate();
    };
    box.append(b);
  }
}

function updateEstimate() {
  const est = state.options?.estimateUsd[Math.min(4, state.photoIds.size)] ?? 0;
  const photos = `${state.photoIds.size} photo${state.photoIds.size === 1 ? "" : "s"}`;
  $("estimate").textContent =
    state.options?.claudeMode === "subscription"
      ? `Uses your Claude subscription: $0 now (tests only). Through the API it would be about ${usd(est)} (${photos}). Rendering is free.`
      : `About ${usd(est)} with ${state.options?.model ?? "Claude"} (${photos}). Rendering is free.`;
}

function renderPhotos() {
  const product = state.products.find((p) => p.id === ($<HTMLSelectElement>("product")).value);
  const box = $("photos");
  box.replaceChildren();
  state.photoIds = new Set(product?.photos.slice(0, 4).map((p) => p.assetId));
  for (const ph of product?.photos ?? []) {
    const img = document.createElement("img");
    img.src = `/api/photo/${ph.assetId}?size=thumb`;
    img.className = state.photoIds.has(ph.assetId) ? "on" : "";
    img.title = ph.description ?? "";
    img.onclick = () => {
      if (state.photoIds.has(ph.assetId)) state.photoIds.delete(ph.assetId);
      else if (state.photoIds.size < 4) state.photoIds.add(ph.assetId);
      img.className = state.photoIds.has(ph.assetId) ? "on" : "";
      updateEstimate();
    };
    box.append(img);
  }
  if (!product?.photos.length) box.textContent = "This product has no photos: Claude designs with text and shapes.";
  $("productInfo").textContent = product ? `${product.summary}${product.price ? ` · ${product.price}` : ""}` : "";
  updateEstimate();
}

async function loadProducts() {
  state.products = await api<Product[]>(`/api/products?business=${encodeURIComponent(($<HTMLSelectElement>("business")).value)}`);
  const sel = $<HTMLSelectElement>("product");
  sel.replaceChildren();
  for (const p of state.products) sel.append(new Option(`${p.name} (${p.photos.length} photos)`, p.id));
  renderPhotos();
}

async function design() {
  const go = $<HTMLButtonElement>("go");
  go.disabled = true;
  play(false);
  status(state.options?.claudeMode === "subscription" ? "Claude is designing the video through your subscription… (usually 1 to 3 minutes)" : "Claude is designing the video… (usually 30 to 90 seconds)");
  try {
    const job = await api<Job>("/api/design", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessId: ($<HTMLSelectElement>("business")).value,
        productId: ($<HTMLSelectElement>("product")).value,
        photoIds: [...state.photoIds],
        styleId: state.styleId,
        hookId: ($<HTMLSelectElement>("hook")).value,
        ratio: state.ratio,
        seconds: state.seconds,
        note: ($<HTMLTextAreaElement>("note")).value,
      }),
    });
    await loadJob(job);
  } catch (error) {
    status(error instanceof Error ? error.message : "Design failed.", "err");
  } finally {
    go.disabled = false;
    await refreshSpend().catch(() => undefined);
  }
}

async function sample() {
  play(false);
  try {
    const job = await api<Job>("/api/sample", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: ($<HTMLSelectElement>("business")).value, productId: ($<HTMLSelectElement>("product")).value }),
    });
    await loadJob(job);
    await refreshSpend();
  } catch (error) {
    status(error instanceof Error ? error.message : "Sample failed.", "err");
  }
}

async function exportMp4() {
  const job = state.job;
  if (!job?.spec) return;
  play(false);
  const btn = $<HTMLButtonElement>("export");
  btn.disabled = true;
  const bar = $("progress");
  bar.style.display = "block";
  const fill = bar.firstElementChild as HTMLElement;
  const started = performance.now();
  status("Making the MP4 in this browser…");
  try {
    const blob = await encodeSpecMp4(job.spec, state.photos, { musicUrl: state.musicOn ? state.musicUrl : null, onProgress: (f) => (fill.style.width = `${Math.round(f * 100)}%`) });
    const ms = Math.round(performance.now() - started);
    status("Saving…");
    const saved = await api<Job>(`/api/jobs/${job.id}/video?ms=${ms}`, { method: "POST", headers: { "content-type": "video/mp4" }, body: blob });
    state.job = { ...saved, spec: job.spec };
    const dl = $<HTMLAnchorElement>("download");
    dl.href = `/videos/${job.id}.mp4?v=${Date.now()}`;
    dl.download = `bupulse-${job.id}.mp4`;
    dl.hidden = false;
    renderSide();
    status(`MP4 ready: ${(blob.size / 1024 / 1024).toFixed(1)} MB, made in ${(ms / 1000).toFixed(0)} s.`, "ok");
    await refreshSpend();
  } catch (error) {
    status(error instanceof Error ? error.message : "The MP4 could not be made.", "err");
  } finally {
    btn.disabled = false;
    bar.style.display = "none";
    fill.style.width = "0";
  }
}

async function applyJson() {
  const job = state.job;
  if (!job) return;
  try {
    const raw = JSON.parse(($<HTMLTextAreaElement>("json")).value);
    const saved = await api<Job>(`/api/jobs/${job.id}/spec`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(raw) });
    await loadJob(saved);
  } catch (error) {
    status(error instanceof Error ? `Could not apply: ${error.message}` : "Could not apply.", "err");
  }
}

async function init() {
  const options = await api<Options>("/api/options");
  state.options = options;
  $("mode").textContent = options.claudeMode === "subscription" ? "· Claude: your subscription (switch to the API key before deploying)" : "· Claude: API key";
  const styles = $("styles");
  const renderStyles = () => {
    styles.replaceChildren();
    for (const s of options.styles) {
      const b = document.createElement("button");
      b.className = `style${s.id === state.styleId ? " on" : ""}`;
      const name = document.createElement("b");
      name.textContent = s.name;
      const blurb = document.createElement("span");
      blurb.textContent = s.blurb;
      b.append(name, blurb);
      b.onclick = () => {
        state.styleId = s.id;
        renderStyles();
      };
      styles.append(b);
    }
  };
  renderStyles();
  const hook = $<HTMLSelectElement>("hook");
  for (const h of options.hooks) hook.append(new Option(h.name, h.id));
  chips("ratios", options.ratios, () => state.ratio, (v) => (state.ratio = v));
  chips("lengths", ["8", "10", "15", "20", "30"], () => String(state.seconds), (v) => (state.seconds = Number(v)), (v) => `${v} s`);
  $("seedanceState").textContent = options.seedanceReady ? "The key is set: Seedance tests come in the next step." : "Waiting for the BytePlus key.";

  const businesses = await api<{ id: string; name: string; products: number }[]>("/api/businesses");
  const sel = $<HTMLSelectElement>("business");
  for (const b of businesses) sel.append(new Option(`${b.name} (${b.products})`, b.id));
  sel.onchange = () => void loadProducts();
  $<HTMLSelectElement>("product").onchange = renderPhotos;
  if (businesses.length) await loadProducts();
  else status("No businesses with products in the test database.", "err");

  $("go").onclick = () => void design();
  $("sample").onclick = () => void sample();
  if (!options.claudeReady) {
    $<HTMLButtonElement>("go").disabled = true;
    status("The Claude API key is not set: add ANTHROPIC_API_KEY to .env (or Admin -> Services) and restart the lab. The free sample design still works.", "err");
  }
  $("play").onclick = () => play(!state.playing);
  $("restart").onclick = () => {
    state.t = 0;
    draw();
  };
  $<HTMLInputElement>("scrub").oninput = (e) => {
    if (!state.job?.spec) return;
    play(false);
    state.t = (Number((e.target as HTMLInputElement).value) / 1000) * totalMs(state.job.spec);
    draw();
  };
  $("export").onclick = () => void exportMp4();
  $("apply").onclick = () => void applyJson();
  $("music").onclick = () => {
    state.musicOn = !state.musicOn;
    $("music").textContent = state.musicUrl ? `Music: ${state.musicOn ? "on" : "off"}` : "Music: none";
  };
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $("claudeForm").hidden = b.dataset.engine !== "claude";
      $("seedanceForm").hidden = b.dataset.engine !== "seedance";
    };
  });
  draw();
  await refreshSpend();
}

void init().catch((error) => status(error instanceof Error ? error.message : "The lab could not start.", "err"));
