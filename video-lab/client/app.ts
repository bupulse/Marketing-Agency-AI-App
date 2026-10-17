// Video Lab page (docs/VIDEO_ENGINE.md): a test studio built like Seedance's and Higgsfield's editors. Plain DOM, no
// framework. The live preview uses the engine's own renderer (lib/video-engine/draw.ts) and the MP4 is made in this
// browser (encode.ts), then saved by the lab server.
import { drawSpecFrame, type Img } from "@/lib/video-engine/draw";
import { encodeSpecMp4, loadPhotos, loadSpecFonts } from "@/lib/video-engine/encode";
import { canvasSize, totalMs, type MotionSpec, type Quality } from "@/lib/video-engine/spec";
import type { VoiceCue } from "@/lib/video-engine/voice";

type Photo = { assetId: string; width: number | null; height: number | null; description: string | null };
type Product = { id: string; name: string; summary: string; price: string | null; photos: Photo[] };
type Usage = { model: string; inputTokens: number; outputTokens: number; costUsd: number };
type Job = {
  id: string;
  createdAt: string;
  businessId: string;
  businessName: string;
  productId: string;
  productName: string;
  styleId: string;
  hookId: string;
  ratio: string;
  seconds: number;
  photoIds: string[];
  spec: MotionSpec | null;
  usage: Usage[];
  costUsd: number;
  apiEquivalentUsd?: number;
  billedTo?: "api" | "subscription";
  status: "designed" | "failed";
  error: string | null;
  video: { bytes: number; renderMs: number; quality?: string } | null;
  edited: boolean;
  mode?: string;
  fixedLens?: boolean;
  parentId?: string | null;
  version?: string | null;
};
type Template = { id: string; category: string; name: string; blurb: string; seconds?: number; hook?: string; presenter: boolean };
type Options = {
  categories: { id: string; name: string }[];
  templates: Template[];
  hooks: { id: string; name: string }[];
  ratios: string[];
  qualities: string[];
  model: string;
  capUsd: number;
  spentUsd: number;
  estimateUsd: number[];
  seedanceReady: boolean;
  claudeMode: "api" | "subscription";
  cast: { id: string; name: string; about: string }[];
};
type Preview = { spec: MotionSpec; photoIds: string[] };
type Influencer = { id: string; name: string; gender: string; age: number; vibe: string; portrait: boolean; shots: { id: string; product: string; action: string }[] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const api = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !(body as { jobs?: unknown }).jobs) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
};
const usd = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);

const MODES: { id: string; name: string; hint: string; photos: string }[] = [
  { id: "reference", name: "Reference", hint: "Claude uses your photos freely (like Seedance's omni reference).", photos: "References" },
  { id: "text", name: "Text", hint: "Text to video: no photos, only text, shapes, colour and camera.", photos: "References (not used)" },
  { id: "image", name: "Image", hint: "Image to video: your first photo is the opening frame, brought to life.", photos: "Opening frame (photo 1)" },
  { id: "firstLast", name: "First + last", hint: "Opens on photo 1 and ends on photo 2; Claude fills the story between.", photos: "First frame (1), last frame (2)" },
];
const LENGTHS = [4, 5, 8, 10, 12, 15, 20, 30];
const PREVIEW_QUALITY: Quality = "720p";

const state = {
  options: null as Options | null,
  products: [] as Product[],
  uploads: [] as string[],
  photoIds: [] as string[],
  mode: "reference",
  templateId: "product-hero",
  ratio: "9:16",
  seconds: 15,
  quality: "1080p" as Quality,
  job: null as Job | null,
  siblings: [] as Job[],
  photos: new Map<number, Img>(),
  musicUrl: null as string | null,
  playing: false,
  t: 0,
  last: 0,
  previews: {} as Record<string, Preview>,
  category: "all",
  influencers: [] as Influencer[],
  influencer: null as string | null,
};

const canvas = $<HTMLCanvasElement>("preview");
const ctx = canvas.getContext("2d")!;

function status(text: string, kind: "" | "err" | "ok" = "") {
  const s = $("status");
  s.textContent = text;
  s.className = `status ${kind}`;
}

// ---- Player ---------------------------------------------------------------------------------------------------------

function draw() {
  const spec = state.job?.spec;
  if (!spec) {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  drawSpecFrame(ctx, spec, state.photos, state.t, { quality: PREVIEW_QUALITY });
  const total = totalMs(spec);
  $<HTMLInputElement>("scrub").value = String(Math.round((state.t / total) * 1000));
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

async function loadJob(job: Job, siblings: Job[] = []) {
  play(false);
  state.job = job;
  if (siblings.length) state.siblings = siblings;
  else if (!state.siblings.some((s) => s.id === job.id)) state.siblings = [];
  renderVersions();
  renderSide();
  renderJobs();
  for (const id of ["export", "apply", "editBtn", "extendBtn"]) $<HTMLButtonElement>(id).disabled = !job.spec;
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
  const size = canvasSize(job.spec, PREVIEW_QUALITY);
  canvas.width = size.width;
  canvas.height = size.height;
  status("Loading photos and fonts…");
  const [photos] = await Promise.all([loadPhotos(job.photoIds.map((id) => `/api/photo/${id}`)), loadSpecFonts(job.spec)]);
  state.photos = photos;
  const track = job.spec.music ? await api<{ id: string; title: string } | null>(`/api/music?mood=${encodeURIComponent(job.spec.music)}`).catch(() => null) : null;
  state.musicUrl = track ? `/api/music/${track.id}` : null;
  $("musicName").textContent = track ? `Music: ${track.title}` : "No music";
  state.t = 0;
  draw();
  const by = job.edited ? "Your edited design." : job.usage.length ? `Designed by Claude${job.mode && job.mode !== "reference" ? ` (${job.mode})` : ""}.` : "Sample design (no AI).";
  status(`${by} Press Play, or Make MP4.`, "ok");
  play(true);
}

function renderVersions() {
  const strip = $("versionStrip");
  strip.replaceChildren();
  if (state.siblings.length < 2) return;
  state.siblings.forEach((j, i) => {
    const b = el("button", { className: j.id === state.job?.id ? "on" : "", textContent: `Version ${i + 1}${j.status === "failed" ? " ✕" : ""}` });
    b.onclick = () => void loadJob(j);
    strip.append(b);
  });
}

function renderSide() {
  const job = state.job;
  const spec = job?.spec;
  $("caption").textContent = spec?.caption || "—";
  $("hashtags").textContent = spec?.hashtags.map((h) => `#${h}`).join(" ") ?? "";
  $<HTMLTextAreaElement>("json").value = spec ? JSON.stringify(spec, null, 2) : "";
  const cams = spec ? [...new Set(spec.scenes.map((s) => s.camera?.move ?? "static"))].join(", ") : "—";
  const rows: [string, string][] = job
    ? [
        ["Engine", job.usage.length ? "Claude-designed" : "Sample design (no AI)"],
        ["Mode", job.mode ?? "reference"],
        ["Template", state.options?.templates.find((t) => t.id === job.styleId)?.name ?? job.styleId],
        ["Model", job.usage[0]?.model ?? "—"],
        ["Claude calls", String(job.usage.length)],
        ["Tokens in / out", job.usage.map((u) => `${u.inputTokens.toLocaleString()} / ${u.outputTokens.toLocaleString()}`).join(" + ") || "—"],
        ["Claude reached by", job.usage.length ? (job.billedTo === "subscription" ? "your subscription (tests only)" : "API key") : "—"],
        ["Claude cost", usd(job.costUsd)],
        ["Same on the API", usd(job.apiEquivalentUsd ?? job.costUsd)],
        ["Camera moves", cams],
        ["Look", spec?.look?.grade ?? "none"],
        ["Rendering", "free (this browser)"],
        ["Video", job.video ? `${(job.video.bytes / 1024 / 1024).toFixed(1)} MB, ${job.video.quality ?? "1080p"}, made in ${(job.video.renderMs / 1000).toFixed(0)} s` : "not made yet"],
        ["Length", spec ? `${(totalMs(spec) / 1000).toFixed(1)} s, ${spec.scenes.length} scenes` : "—"],
      ]
    : [["Nothing yet", ""]];
  $("cost").replaceChildren(...rows.flatMap(([k, v]) => [el("span", { className: "k", textContent: k }), el("span", { textContent: v })]));
}

let jobsCache: Job[] = [];
async function refreshSpend() {
  const data = await api<{ jobs: Job[]; spentUsd: number; capUsd: number }>("/api/jobs");
  const pct = Math.min(100, (data.spentUsd / data.capUsd) * 100);
  const fill = el("i");
  fill.style.width = `${pct}%`;
  $("spend").replaceChildren("Today: ", el("b", { textContent: usd(data.spentUsd) }), ` of $${data.capUsd.toFixed(2)}`, el("span", { className: "bar" }, fill));
  jobsCache = data.jobs;
  renderJobs();
}

function renderJobs() {
  const list = $("jobs");
  list.replaceChildren();
  for (const j of jobsCache) {
    const cost = j.billedTo === "subscription" ? `$0 · API ${usd(j.apiEquivalentUsd ?? 0)}` : usd(j.costUsd);
    const meta = `${new Date(j.createdAt).toLocaleString()} · ${j.mode ?? "reference"} · ${j.styleId} · ${j.ratio}${j.version ? ` · v${j.version}` : ""}${j.parentId ? " · edit/extend" : ""}${j.video ? " · MP4" : ""}${j.status === "failed" ? " · failed" : ""}`;
    const b = el("button", { className: `job${j.status === "failed" ? " failed" : ""}${state.job?.id === j.id ? " active" : ""}` }, el("b", { textContent: j.productName }), el("span", { textContent: cost }), el("small", { textContent: meta }));
    b.onclick = async () => loadJob(await api<Job>(`/api/jobs/${j.id}`));
    list.append(b);
  }
  if (!jobsCache.length) list.textContent = "No tests yet.";
}

// ---- Form -----------------------------------------------------------------------------------------------------------

function chips(containerId: string, values: string[], current: () => string, set: (v: string) => void, label = (v: string) => v) {
  const box = $(containerId);
  box.replaceChildren(
    ...values.map((v) => {
      const b = el("button", { textContent: label(v), className: current() === v ? "on" : "" });
      b.onclick = () => {
        set(v);
        chips(containerId, values, current, set, label);
        updateEstimate();
      };
      return b;
    }),
  );
}

function renderModes() {
  $("modes").replaceChildren(
    ...MODES.map((m) => {
      const b = el("button", { textContent: m.name, className: m.id === state.mode ? "on" : "" });
      b.onclick = () => {
        state.mode = m.id;
        renderModes();
        renderPhotos();
      };
      return b;
    }),
  );
  const mode = MODES.find((m) => m.id === state.mode) ?? MODES[0];
  $("modeHint").textContent = mode.hint;
  $("photosTitle").textContent = mode.photos;
}

function updateEstimate() {
  const n = state.mode === "text" ? 0 : Math.min(4, state.photoIds.length);
  const versions = Number($<HTMLSelectElement>("versions").value) || 1;
  const est = (state.options?.estimateUsd[n] ?? 0) * versions;
  const v = versions > 1 ? ` for ${versions} versions` : "";
  $("estimate").textContent =
    state.options?.claudeMode === "subscription"
      ? `Uses your Claude subscription: $0 now (tests only). On the API about ${usd(est)}${v}. Rendering is free.`
      : `About ${usd(est)}${v} with ${state.options?.model ?? "Claude"}. Rendering is free.`;
}

function currentProduct(): Product | undefined {
  return state.products.find((p) => p.id === $<HTMLSelectElement>("product").value);
}

function renderPhotos() {
  const product = currentProduct();
  const ids = [...(product?.photos.map((p) => p.assetId) ?? []), ...state.uploads];
  state.photoIds = state.photoIds.filter((id) => ids.includes(id));
  const box = $("photos");
  box.replaceChildren();
  for (const id of ids) {
    const order = state.photoIds.indexOf(id);
    const wrap = el("div", { className: `ph${order >= 0 ? " on" : ""}` }, el("img", { src: `/api/photo/${id}?size=thumb`, title: product?.photos.find((p) => p.assetId === id)?.description ?? (id.startsWith("up-") ? "Your upload" : "") }), el("b", { textContent: String(order + 1) }));
    wrap.onclick = () => {
      const i = state.photoIds.indexOf(id);
      if (i >= 0) state.photoIds.splice(i, 1);
      else if (state.photoIds.length < 4) state.photoIds.push(id);
      renderPhotos();
    };
    box.append(wrap);
  }
  const up = el("div", { className: "up", title: "Upload a photo", textContent: "+" });
  up.onclick = () => $<HTMLInputElement>("file").click();
  box.append(up);
  $("productInfo").textContent = product ? `${product.summary}${product.price ? ` · ${product.price}` : ""}` : "";
  updateEstimate();
}

async function loadProducts() {
  state.products = await api<Product[]>(`/api/products?business=${encodeURIComponent($<HTMLSelectElement>("business").value)}`);
  const sel = $<HTMLSelectElement>("product");
  sel.replaceChildren(...state.products.map((p) => new Option(`${p.name} (${p.photos.length} photos)`, p.id)));
  state.photoIds = currentProduct()?.photos.slice(0, 3).map((p) => p.assetId) ?? [];
  renderPhotos();
}

function setTemplate(id: string) {
  const t = state.options?.templates.find((x) => x.id === id);
  if (!t) return;
  state.templateId = id;
  $("templateName").textContent = `${state.options?.categories.find((c) => c.id === t.category)?.name ?? ""} · ${t.name}`;
  $("templateBlurb").textContent = `${t.blurb}${t.presenter ? " (Presenter templates use the product and captions until influencers arrive.)" : ""}`;
  if (t.seconds) {
    state.seconds = t.seconds;
    chips("lengths", LENGTHS.map(String), () => String(state.seconds), (v) => (state.seconds = Number(v)), (v) => `${v} s`);
  }
  if (t.hook) $<HTMLSelectElement>("hook").value = t.hook;
}

// ---- AI influencers ------------------------------------------------------------------------------------------------

async function loadInfluencers() {
  const out = await api<{ influencers: Influencer[]; actions: { id: string; text: string }[] }>("/api/influencers");
  state.influencers = out.influencers;
  const sel = $<HTMLSelectElement>("inflAction");
  if (!sel.options.length) sel.replaceChildren(...out.actions.map((a) => new Option(a.text, a.id)));
  renderInfluencers();
}

function renderInfluencers() {
  const box = $("infl");
  box.replaceChildren(
    ...state.influencers.map((i) => {
      const face = i.portrait ? el("img", { src: `/api/influencers/${i.id}/portrait?v=${Date.now() % 100000}`, alt: i.name }) : el("div", { className: "face", textContent: i.name[0] });
      const b = el("button", { className: `pres${state.influencer === i.id ? " on" : ""}`, title: `${i.name}, ${i.age}: ${i.vibe}` }, face, el("span", { textContent: `${i.name}, ${i.age}` }));
      b.onclick = () => {
        state.influencer = state.influencer === i.id ? null : i.id;
        renderInfluencers();
      };
      return b;
    }),
  );
  const i = state.influencers.find((x) => x.id === state.influencer);
  $("inflTools").hidden = !i;
  if (!i) return;
  $("inflPortrait").textContent = i.portrait ? `New portrait of ${i.name} (~$0.04)` : `Make ${i.name}'s portrait (~$0.04)`;
  $<HTMLButtonElement>("inflShot").disabled = !i.portrait;
  $("inflHint").textContent = i.portrait
    ? `A shot is a realistic photo of ${i.name} with this product (Gemini, ~$0.04). It goes into the references; Claude puts it in the video with camera moves. ${i.name} does not talk yet (that comes with Seedance).`
    : `First make ${i.name}'s portrait: every shot keeps this face.`;
}

async function influencerCall(kind: "portrait" | "shot") {
  const i = state.influencers.find((x) => x.id === state.influencer);
  if (!i) return;
  const btn = $<HTMLButtonElement>(kind === "portrait" ? "inflPortrait" : "inflShot");
  btn.disabled = true;
  status(kind === "portrait" ? `Making ${i.name}'s portrait with Gemini…` : `Making a shot of ${i.name} with ${currentProduct()?.name ?? "the product"}…`);
  try {
    const productPhoto = state.photoIds.find((id) => !id.startsWith("up-")) ?? currentProduct()?.photos[0]?.assetId;
    const out = await api<{ uploadId?: string; costUsd: number }>(`/api/influencers/${i.id}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: $<HTMLSelectElement>("business").value, productId: $<HTMLSelectElement>("product").value, photoId: productPhoto, action: $<HTMLSelectElement>("inflAction").value, setting: $<HTMLInputElement>("inflSetting").value, ratio: state.ratio }),
    });
    if (out.uploadId) {
      state.uploads.unshift(out.uploadId);
      state.photoIds = [out.uploadId, ...state.photoIds].slice(0, 4);
      renderPhotos();
    }
    await loadInfluencers();
    status(`${kind === "portrait" ? "Portrait" : "Shot"} ready (${usd(out.costUsd)}).${out.uploadId ? " It is reference 1 now." : ""}`, "ok");
    await refreshSpend();
  } catch (error) {
    status(error instanceof Error ? error.message : "The image could not be made.", "err");
  } finally {
    btn.disabled = false;
  }
}

// ---- Templates gallery ----------------------------------------------------------------------------------------------

const previewPhotos = new Map<string, Promise<Map<number, Img>>>();
function photosFor(ids: string[]) {
  const key = ids.join(",");
  if (!previewPhotos.has(key)) previewPhotos.set(key, loadPhotos(ids.map((id) => `/api/photo/${id}?size=thumb`)));
  return previewPhotos.get(key) as Promise<Map<number, Img>>;
}

function renderTemplates() {
  const o = state.options;
  if (!o) return;
  const cats = [{ id: "all", name: "All" }, ...o.categories];
  $("cats").replaceChildren(
    ...cats.map((c) => {
      const b = el("button", { textContent: c.name, className: c.id === state.category ? "on" : "" });
      b.onclick = () => {
        state.category = c.id;
        renderTemplates();
      };
      return b;
    }),
  );
  const q = $<HTMLInputElement>("tsearch").value.trim().toLowerCase();
  const list = o.templates.filter((t) => (state.category === "all" || t.category === state.category) && (!q || `${t.name} ${t.blurb}`.toLowerCase().includes(q)));
  const grid = $("tgrid");
  grid.replaceChildren();
  for (const t of list) {
    const thumb = el("div", { className: "thumb", textContent: t.name });
    thumb.append(el("span", { className: "badge", textContent: o.categories.find((c) => c.id === t.category)?.name ?? "" }));
    const card = el("button", { className: `tcard${t.id === state.templateId ? " on" : ""}` }, thumb, el("div", { className: "meta" }, el("b", { textContent: t.name }), el("span", { textContent: t.blurb })));
    card.onclick = () => {
      setTemplate(t.id);
      ($("templates") as HTMLDialogElement).close();
    };
    const pv = state.previews[t.id];
    if (pv) void mountPreview(thumb, pv, card);
    grid.append(card);
  }
}

/** A live, looping mini preview of a template's example video (made once in the lab, see the server). */
async function mountPreview(host: HTMLElement, pv: Preview, card: HTMLElement) {
  const size = canvasSize(pv.spec, "480p");
  const c = el("canvas", { width: size.width, height: size.height });
  host.prepend(c);
  const g = c.getContext("2d")!;
  const photos = await photosFor(pv.photoIds);
  await loadSpecFonts(pv.spec);
  const total = totalMs(pv.spec);
  let t = 1200;
  let hover = false;
  drawSpecFrame(g, pv.spec, photos, t, { quality: "480p" });
  card.onmouseenter = () => {
    hover = true;
    let last = performance.now();
    const loop = (now: number) => {
      if (!hover || !c.isConnected) return;
      t = (t + now - last) % total;
      last = now;
      drawSpecFrame(g, pv.spec, photos, t, { quality: "480p" });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  card.onmouseleave = () => (hover = false);
}

// ---- Actions --------------------------------------------------------------------------------------------------------

async function generate(body: Record<string, unknown>, label: string) {
  const go = $<HTMLButtonElement>("go");
  go.disabled = true;
  play(false);
  status(label);
  try {
    const out = await api<{ jobs: Job[]; error: string | null }>("/api/design", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const first = out.jobs.find((j) => j.status !== "failed") ?? out.jobs[0];
    if (first) await loadJob(first, out.jobs.length > 1 ? out.jobs : []);
    if (out.error) status(out.error, "err");
  } catch (error) {
    status(error instanceof Error ? error.message : "Generation failed.", "err");
  } finally {
    go.disabled = false;
    await refreshSpend().catch(() => undefined);
  }
}

const sub = () => state.options?.claudeMode === "subscription";

function newVideo() {
  const versions = Number($<HTMLSelectElement>("versions").value) || 1;
  void generate(
    {
      mode: state.mode,
      businessId: $<HTMLSelectElement>("business").value,
      productId: $<HTMLSelectElement>("product").value,
      photoIds: state.mode === "text" ? [] : state.photoIds,
      styleId: state.templateId,
      hookId: $<HTMLSelectElement>("hook").value,
      ratio: state.ratio,
      seconds: state.seconds,
      note: $<HTMLTextAreaElement>("note").value,
      fixedLens: $<HTMLInputElement>("fixedLens").checked,
      cartoonId: $<HTMLSelectElement>("cartoon").value || null,
      versions,
    },
    `Claude is designing ${versions > 1 ? `${versions} versions` : "the video"}${sub() ? " through your subscription" : ""}… (about ${versions > 2 ? "2 to 4" : "1 to 2"} minutes)`,
  );
}

function editVideo() {
  if (!state.job?.spec) return;
  void generate({ mode: "edit", baseJobId: state.job.id, note: $<HTMLTextAreaElement>("editNote").value }, "Claude is changing the video…");
}

function extendVideo() {
  if (!state.job?.spec) return;
  void generate({ mode: "extend", baseJobId: state.job.id, note: $<HTMLTextAreaElement>("extendNote").value, seconds: Number($<HTMLSelectElement>("extendSeconds").value) }, "Claude is extending the video…");
}

async function sample() {
  play(false);
  try {
    const job = await api<Job>("/api/sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: $<HTMLSelectElement>("business").value, productId: $<HTMLSelectElement>("product").value }) });
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
  status(`Making the ${state.quality} MP4 in this browser…`);
  try {
    const music = $<HTMLInputElement>("sound").checked ? state.musicUrl : null;
    // The voice-over (ElevenLabs) first: the design may be stretched to fit it. Without it the MP4 is still made.
    let spec = job.spec;
    let voice: { url: string; cues: VoiceCue[] } | null = null;
    if ($<HTMLInputElement>("voiceOver").checked) {
      try {
        const out = await api<{ voice: { url: string; cues: VoiceCue[]; spec: MotionSpec; fits: boolean } | null }>(`/api/jobs/${job.id}/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        if (out.voice) {
          spec = out.voice.spec;
          voice = { url: out.voice.url, cues: out.voice.cues };
        }
        if (out.voice && !out.voice.fits) status("Voice cut to fit 30 s. Making the MP4…");
      } catch (error) {
        status(`No voice-over: ${error instanceof Error ? error.message : "it failed"}. Making the MP4 without it…`);
      }
    }
    const blob = await encodeSpecMp4(spec, state.photos, { musicUrl: music, voice, quality: state.quality, onProgress: (f) => (fill.style.width = `${Math.round(f * 100)}%`) });
    const ms = Math.round(performance.now() - started);
    const saved = await api<Job>(`/api/jobs/${job.id}/video?ms=${ms}&q=${state.quality}`, { method: "POST", headers: { "content-type": "video/mp4" }, body: blob });
    state.job = { ...saved, spec: job.spec };
    const dl = $<HTMLAnchorElement>("download");
    dl.href = `/videos/${job.id}.mp4?v=${Date.now()}`;
    dl.download = `bupulse-${job.id}.mp4`;
    dl.hidden = false;
    renderSide();
    status(`MP4 ready: ${(blob.size / 1024 / 1024).toFixed(1)} MB, ${state.quality}, made in ${(ms / 1000).toFixed(0)} s.`, "ok");
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
    const raw = JSON.parse($<HTMLTextAreaElement>("json").value);
    await loadJob(await api<Job>(`/api/jobs/${job.id}/spec`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(raw) }));
  } catch (error) {
    status(error instanceof Error ? `Could not apply: ${error.message}` : "Could not apply.", "err");
  }
}

async function upload(file: File) {
  status("Uploading the photo…");
  try {
    const out = await api<{ id: string }>("/api/upload", { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    state.uploads.push(out.id);
    if (state.photoIds.length < 4) state.photoIds.push(out.id);
    renderPhotos();
    status("Photo added.", "ok");
  } catch (error) {
    status(error instanceof Error ? error.message : "Upload failed.", "err");
  }
}

// ---- Start ----------------------------------------------------------------------------------------------------------

async function init() {
  const options = await api<Options>("/api/options");
  state.options = options;
  $("mode").textContent = options.claudeMode === "subscription" ? "· Claude: your subscription (switch to the API key before deploying)" : "· Claude: API key";
  renderModes();
  $<HTMLSelectElement>("cartoon").append(...options.cast.map((c) => new Option(`${c.name}: ${c.about}`, c.id)));
  const hook = $<HTMLSelectElement>("hook");
  hook.replaceChildren(...options.hooks.map((h) => new Option(h.name, h.id)));
  chips("ratios", options.ratios, () => state.ratio, (v) => (state.ratio = v));
  chips("lengths", LENGTHS.map(String), () => String(state.seconds), (v) => (state.seconds = Number(v)), (v) => `${v} s`);
  chips("qualities", options.qualities, () => state.quality, (v) => (state.quality = v as Quality));
  setTemplate(state.templateId);
  $("seedanceState").textContent = options.seedanceReady ? "The key is set: Seedance comes in the next step." : "Waiting for the BytePlus key.";
  state.previews = await api<Record<string, Preview>>("/api/template-previews").catch(() => ({}));

  const businesses = await api<{ id: string; name: string; products: number }[]>("/api/businesses");
  const sel = $<HTMLSelectElement>("business");
  sel.replaceChildren(...businesses.map((b) => new Option(`${b.name} (${b.products})`, b.id)));
  sel.onchange = () => void loadProducts();
  $<HTMLSelectElement>("product").onchange = () => {
    state.photoIds = currentProduct()?.photos.slice(0, 3).map((p) => p.assetId) ?? [];
    renderPhotos();
  };
  if (businesses.length) await loadProducts();
  else status("No businesses with products in the test database.", "err");

  $<HTMLInputElement>("file").onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void upload(f);
    (e.target as HTMLInputElement).value = "";
  };
  $<HTMLSelectElement>("versions").onchange = updateEstimate;
  $("inflPortrait").onclick = () => void influencerCall("portrait");
  $("inflShot").onclick = () => void influencerCall("shot");
  await loadInfluencers().catch(() => undefined);
  $("go").onclick = newVideo;
  $("sample").onclick = () => void sample();
  $("editBtn").onclick = editVideo;
  $("extendBtn").onclick = extendVideo;
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
  const dlg = $("templates") as HTMLDialogElement;
  $("templateBtn").onclick = () => {
    renderTemplates();
    dlg.showModal();
  };
  $("tclose").onclick = () => dlg.close();
  $<HTMLInputElement>("tsearch").oninput = renderTemplates;
  document.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("[data-engine]").forEach((x) => x.classList.toggle("on", x === b));
      $("claudeForm").hidden = b.dataset.engine !== "claude";
      $("seedanceForm").hidden = b.dataset.engine !== "seedance";
    };
  });
  draw();
  await refreshSpend();
}

void init().catch((error) => status(error instanceof Error ? error.message : "The lab could not start.", "err"));
