// The Create page (docs/VIDEO_ENGINE.md, "Studio"): one prompt bar for both engines, in the style of Higgsfield's
// Marketing Studio and Seedance's app. Real video goes to BytePlus through the lab server (submit, then poll);
// Motion videos are designed by Claude and drawn here (lib/video-engine), with the MP4 made in this browser.
// The model pages (/app/video/<model>) are this page with the model preselected (body data-model, models.json).
import { drawSpecFrame, type Img } from "@/lib/video-engine/draw";
import { encodeSpecMp4, loadPhotos, loadSpecFonts } from "@/lib/video-engine/encode";
import { canvasSize, totalMs, type MotionSpec, type Quality } from "@/lib/video-engine/spec";
import type { VoiceCue } from "@/lib/video-engine/voice";
import { categoryName } from "./i18n";
import { loadPricing, modelById, wireExamples } from "./models";
import { $, api, el, refreshWallet } from "./site";

type Engine = "seedance" | "claude";
type RefKind = "image" | "video" | "audio";
type Ref = { id: string; kind: RefKind; thumb: string | null; label: string; role?: "first_frame" | "last_frame" | "reference_image" };
type Template = { id: string; category: string; name: string; blurb: string; seconds?: number; hook?: string; presenter: boolean };
type Options = {
  categories: { id: string; name: string }[];
  templates: Template[];
  hooks: { id: string; name: string }[];
  ratios: string[];
  qualities: string[];
  claudeMode: "api" | "subscription";
  seedanceReady: boolean;
  cast: { id: string; name: string; about: string }[];
  seedance: { tiers: { id: string; name: string; blurb: string; resolutions: string[] }[]; ratios: string[]; limits: { minSeconds: number; maxSeconds: number } };
};
type ClaudeJob = { id: string; createdAt: string; productName: string; styleId: string; ratio: string; photoIds: string[]; spec: MotionSpec | null; usage: unknown[]; apiEquivalentUsd?: number; status: string; error: string | null; video: { bytes: number; quality?: string } | null; mode?: string };
type SdJob = { id: string; createdAt: string; status: string; credits: number; estimateUsd: number; costUsd: number; tokens: number; videoFile: string | null; error: string | null; title: string; request: { prompt: string; tier: string; resolution: string; ratio: string; seconds: number; referenceNotes: string[] }; preview?: { notice: string; readyAt: string; wouldCostCredits: number } };
type Issue = { level: "error" | "warning" | "info"; code: string; message: string };
type StoryShot = { n: number; from: number; to: number; shot: string; camera: string; action: string; sound: string | null; spoken: string | null; references: string[] };
type Storyboard = { notice: string; model: string; resolution: string; ratio: string; seconds: number; audio: boolean; setting: string | null; shots: StoryShot[]; frames: { at: number; shot: number; caption: string; svg: string }[]; references: { label: string; kind: string; thumb: string | null }[]; estimate: { usd: number; credits: number; wait: string }; issues: Issue[] };
type PreviewAnswer = { ready: false; readyInMs: number; notice: string } | { ready: true; storyboard: Storyboard };
type Gen = { engine: Engine; id: string; title: string; status: string; at: string; videoUrl: string | null; claude?: ClaudeJob; sd?: SdJob };
type Product = { id: string; name: string; summary: string; price: string | null; photos: { assetId: string; description: string | null }[] };
type Preview = { spec: MotionSpec; photoIds: string[] };
type Influencer = { id: string; name: string; age: number; vibe: string; portrait: boolean; shots: { id: string; product: string; action: string }[] };

const SEEDANCE_SECONDS = [4, 5, 6, 8, 10, 12, 15];
const CLAUDE_SECONDS = [8, 10, 12, 15, 20, 30];

const state = {
  o: null as Options | null,
  engine: "seedance" as Engine,
  mode: "reference",
  templateId: "product-hero",
  ratio: "9:16",
  seconds: 5,
  tier: "fast",
  resolution: "720p",
  quality: "1080p" as Quality,
  versions: 1,
  audio: true,
  /** Motion videos: an ElevenLabs voice-over of the design's lines when the MP4 is made. */
  voice: true,
  fixedLens: false,
  flex: false,
  draft: false,
  seed: "" as string,
  hookId: "auto",
  refs: [] as Ref[],
  businessId: "",
  productId: "",
  products: [] as Product[],
  businesses: [] as { id: string; name: string }[],
  avatar: null as { kind: "influencer" | "cartoon"; id: string; label: string; thumb: string | null } | null,
  gens: [] as Gen[],
  previews: {} as Record<string, Preview>,
  category: "all",
  open: null as Gen | null,
  credits: 0,
  claudeCredits: 0,
  voiceCredits: 10,
  planVariant: 0,
  checkErrors: [] as Issue[],
  photos: new Map<number, Img>(),
  playing: false,
};

const MODES: Record<Engine, { id: string; name: string; hint: string }[]> = {
  seedance: [
    { id: "reference", name: "Reference", hint: "Photos, videos and audio the model follows (omni reference)." },
    { id: "text", name: "Text", hint: "Text to video: describe everything, no references." },
    { id: "image", name: "Image", hint: "Image to video: the first image is the opening frame." },
    { id: "firstLast", name: "First + last", hint: "Image 1 opens, Image 2 closes." },
    { id: "edit", name: "Edit", hint: "Change a finished video: add it as Video 1 and describe the change." },
    { id: "extend", name: "Extend", hint: "Continue a finished video: add it as Video 1 and describe what happens next." },
  ],
  claude: [
    { id: "reference", name: "Reference", hint: "Claude uses your photos freely." },
    { id: "text", name: "Text", hint: "No photos: text, shapes, colour and camera." },
    { id: "image", name: "Image", hint: "Photo 1 is the opening frame." },
    { id: "firstLast", name: "First + last", hint: "Opens on photo 1, ends on photo 2." },
  ],
};

const msg = (text: string, kind: "" | "err" | "ok" = "") => {
  const m = $("msg");
  m.textContent = text;
  m.className = `msg ${kind}`;
};

// ---- Pills and popovers --------------------------------------------------------------------------------------------

function pop(id: string, build: (box: HTMLElement) => void) {
  const btn = $(id);
  const box = btn.querySelector(".pop") as HTMLElement;
  btn.onclick = (e) => {
    if ((e.target as HTMLElement).closest(".pop")) return;
    const open = box.classList.contains("open");
    document.querySelectorAll(".pop.open").forEach((p) => p.classList.remove("open"));
    if (!open) {
      box.replaceChildren();
      build(box);
      box.classList.add("open");
    }
  };
}
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest(".pillBtn")) document.querySelectorAll(".pop.open").forEach((p) => p.classList.remove("open"));
});

function chips(values: string[], current: string, set: (v: string) => void, label = (v: string) => v) {
  const row = el("div", { className: "row" });
  for (const v of values) {
    const b = el("button", { className: `btn sm${v === current ? " on" : ""}`, textContent: label(v) });
    b.onclick = (e) => {
      e.stopPropagation();
      set(v);
      document.querySelectorAll(".pop.open").forEach((p) => p.classList.remove("open"));
      renderPills();
    };
    row.append(b);
  }
  return row;
}

function renderPills() {
  const o = state.o;
  if (!o) return;
  const sd = state.engine === "seedance";
  $("pModeV").textContent = MODES[state.engine].find((m) => m.id === state.mode)?.name ?? "Reference";
  $("pTemplateV").textContent = o.templates.find((t) => t.id === state.templateId)?.name ?? "Template";
  $("pRatioV").textContent = state.ratio;
  $("pSecondsV").textContent = `${state.seconds}s`;
  $("pQualityV").textContent = sd ? `${o.seedance.tiers.find((t) => t.id === state.tier)?.name.replace("Seedance 2.0 ", "") || "Pro"} · ${state.resolution}` : state.quality;
  $("pVersionsV").textContent = `${state.versions}/4`;
  $("go").className = `genBtn${sd ? " bp" : ""}`;
  $("pWrite").hidden = !sd;
  $("pPlan").hidden = !sd;
  $("tAvatar").hidden = false;
  void quote();
  scheduleCheck();
}

// ---- Seedance checks (lib/video-engine/seedance-brain.ts, through /api/seedance/check) -------------------------------

/** What Generate would send to Seedance. */
const seedanceBody = () => ({ prompt: $<HTMLTextAreaElement>("prompt").value.trim(), refs: state.refs.map((r) => ({ id: r.id, kind: r.kind, role: r.role, label: r.label })), tier: state.tier, resolution: state.resolution, ratio: state.ratio, seconds: state.seconds, audio: state.audio, fixedLens: state.fixedLens, flex: state.flex, draft: state.draft, seed: state.seed ? Number(state.seed) : null, versions: state.versions, businessId: state.businessId, productId: state.productId, mode: state.mode });

function showIssues(issues: Issue[]) {
  const box = $("sdChecks");
  // An empty prompt is normal while the owner is still setting up: Generate says so when pressed.
  const shown = issues.filter((i) => i.level !== "info" && i.code !== "prompt-empty");
  box.hidden = !shown.length || state.engine !== "seedance";
  box.replaceChildren(...shown.map((i) => el("div", { className: `issue ${i.level}`, textContent: `${i.level === "error" ? "Fix before Generate: " : "Note: "}${i.message}` })));
}

/** Runs the check; errors block Generate (and are returned), warnings are shown beside it. */
async function checkSeedance(): Promise<Issue[]> {
  if (state.engine !== "seedance") {
    $("sdChecks").hidden = true;
    return [];
  }
  try {
    const out = await api<{ ok: boolean; issues: Issue[] }>("/api/seedance/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(seedanceBody()) });
    state.checkErrors = out.issues.filter((i) => i.level === "error");
    showIssues(out.issues);
    return state.checkErrors;
  } catch {
    return [];
  }
}

let checkTimer = 0;
function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => void checkSeedance(), 700);
}

async function quote() {
  const sd = state.engine === "seedance";
  try {
    const q = await api<{ credits: number; usd: number }>("/api/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sd ? { engine: "seedance", tier: state.tier, resolution: state.draft ? "480p" : state.resolution, seconds: state.seconds, versions: state.versions } : { engine: "claude", versions: state.versions, photos: state.refs.filter((r) => r.kind === "image").length, voice: state.voice }),
    });
    state.credits = q.credits;
    $("goCredits").textContent = `✦ ${q.credits}`;
    $("go").title = `About $${q.usd.toFixed(2)} of provider cost`;
  } catch {
    $("goCredits").textContent = "✦ …";
  }
}

function setupPills() {
  const o = state.o as Options;
  pop("pMode", (box) => {
    box.append(el("h6", { textContent: "Mode" }));
    for (const m of MODES[state.engine]) {
      const b = el("button", { className: `btn sm${m.id === state.mode ? " on" : ""}`, textContent: m.name, title: m.hint, style: "margin:0 6px 6px 0" });
      b.onclick = (e) => {
        e.stopPropagation();
        state.mode = m.id;
        msg(m.hint);
        document.querySelectorAll(".pop.open").forEach((p) => p.classList.remove("open"));
        renderPills();
      };
      box.append(b);
    }
  });
  pop("pRatio", (box) => {
    box.append(el("h6", { textContent: "Aspect ratio" }), chips(state.engine === "seedance" ? o.seedance.ratios : o.ratios, state.ratio, (v) => (state.ratio = v)));
  });
  pop("pSeconds", (box) => {
    box.append(el("h6", { textContent: "Duration" }), chips((state.engine === "seedance" ? SEEDANCE_SECONDS : CLAUDE_SECONDS).map(String), String(state.seconds), (v) => (state.seconds = Number(v)), (v) => `${v} s`));
  });
  pop("pQuality", (box) => {
    if (state.engine === "seedance") {
      box.append(el("h6", { textContent: "Quality" }), chips(o.seedance.tiers.map((t) => t.id), state.tier, (v) => {
        state.tier = v;
        const allowed = o.seedance.tiers.find((t) => t.id === v)?.resolutions ?? [];
        if (!allowed.includes(state.resolution)) state.resolution = allowed[allowed.length - 1];
      }, (v) => o.seedance.tiers.find((t) => t.id === v)?.name.replace("Seedance 2.0 ", "") ?? v));
      box.append(el("h6", { textContent: "Resolution" }), chips(o.seedance.tiers.find((t) => t.id === state.tier)?.resolutions ?? ["720p"], state.resolution, (v) => (state.resolution = v)));
      box.append(el("p", { className: "hint", textContent: o.seedance.tiers.find((t) => t.id === state.tier)?.blurb ?? "" }));
    } else {
      box.append(el("h6", { textContent: "MP4 quality" }), chips(o.qualities, state.quality, (v) => (state.quality = v as Quality)));
    }
  });
  pop("pMore", (box) => {
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const input = el("input", { type: "checkbox", checked: get() });
      input.onchange = () => set(input.checked);
      return el("label", { className: "toggle" }, label, input);
    };
    box.append(el("h6", { textContent: "Options" }));
    if (state.engine === "seedance") {
      box.append(toggle("Generate sound", () => state.audio, (v) => (state.audio = v)), toggle("Fixed lens (no camera move)", () => state.fixedLens, (v) => (state.fixedLens = v)), toggle("Offline: slower, cheaper", () => state.flex, (v) => (state.flex = v)), toggle("Draft preview (480p)", () => state.draft, (v) => { state.draft = v; void quote(); }));
      const seed = el("input", { type: "text", placeholder: "Seed (optional, a number)", value: state.seed, style: "margin-top:8px" });
      seed.oninput = () => (state.seed = seed.value.replace(/\D/g, "").slice(0, 10));
      seed.onclick = (e) => e.stopPropagation();
      box.append(seed);
    } else {
      box.append(toggle("Fixed lens (no camera move)", () => state.fixedLens, (v) => (state.fixedLens = v)));
      box.append(toggle(`Voice-over (${state.voiceCredits} credits, added when the MP4 is made)`, () => state.voice, (v) => { state.voice = v; void quote(); }));
      box.append(el("h6", { textContent: "Opening hook" }), chips(o.hooks.map((h) => h.id), state.hookId, (v) => (state.hookId = v), (v) => o.hooks.find((h) => h.id === v)?.name ?? v));
    }
  });
  $("pVersions").onclick = (e) => {
    const x = (e as MouseEvent).offsetX;
    const w = ($("pVersions") as HTMLElement).offsetWidth;
    state.versions = Math.max(1, Math.min(4, state.versions + (x < w / 2 ? -1 : 1)));
    renderPills();
  };
  $("pTemplate").onclick = () => document.getElementById("tgrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  $("pAdd").onclick = () => openPicker("refs");
  $("tProduct").onclick = () => openPicker("product");
  $("tAvatar").onclick = () => openPicker("avatar");
  $("pWrite").onclick = () => void writeWithClaude();
  $("pPlan").onclick = () => void quickPlan();
  $<HTMLTextAreaElement>("prompt").addEventListener("input", scheduleCheck);
  document.querySelectorAll<HTMLButtonElement>("#engineSw button").forEach((b) => {
    b.onclick = () => {
      setEngine(b.dataset.engine as Engine);
      msg(state.engine === "seedance" ? "Real video with Seedance 2.0: moving people, places and sound. 1 to 10 minutes." : "Motion video designed by Claude: instant, a few credits.");
    };
  });
}

/** Switches the engine (the prompt and the references stay). */
function setEngine(engine: Engine) {
  state.engine = engine;
  document.querySelectorAll<HTMLButtonElement>("#engineSw button").forEach((x) => x.classList.toggle("on", x.dataset.engine === engine));
  state.mode = "reference";
  state.seconds = engine === "seedance" ? 5 : 15;
  $<HTMLTextAreaElement>("prompt").placeholder = engine === "seedance" ? "Describe the scene, the camera and the sound. Refer to references as Image 1, Video 1, Audio 1…" : "Describe the video you want (optional). Claude designs it from your product and template.";
  renderPills();
  renderRefs();
}

// ---- References, product and avatar ----------------------------------------------------------------------------------

function renderRefs() {
  const strip = $("refStrip");
  strip.replaceChildren();
  const counts = { image: 0, video: 0, audio: 0 };
  state.refs.forEach((r, i) => {
    counts[r.kind] += 1;
    const tile = el("div", { className: "ref on", title: `${r.label}. Click to remove.` });
    if (r.thumb) tile.append(el("img", { src: r.thumb }));
    tile.append(el("b", { textContent: `${r.kind === "image" ? "Image" : r.kind === "video" ? "Video" : "Audio"} ${counts[r.kind]}` }), el("i", { textContent: r.role === "first_frame" ? "first" : r.role === "last_frame" ? "last" : r.kind }));
    tile.onclick = () => {
      state.refs.splice(i, 1);
      renderRefs();
    };
    strip.append(tile);
  });
  const p = state.products.find((x) => x.id === state.productId);
  const tp = $("tProduct");
  tp.replaceChildren(el("span", { className: "plus", textContent: p ? "✓" : "+" }), el("span", { textContent: p ? p.name.slice(0, 14).toUpperCase() : "PRODUCT" }));
  if (p?.photos[0]) tp.prepend(el("img", { src: `/api/photo/${p.photos[0].assetId}?size=thumb` }));
  tp.classList.toggle("on", !!p);
  const ta = $("tAvatar");
  ta.replaceChildren(el("span", { className: "plus", textContent: state.avatar ? "✓" : "+" }), el("span", { textContent: state.avatar ? state.avatar.label.toUpperCase() : "AVATAR" }));
  if (state.avatar?.thumb) ta.prepend(el("img", { src: state.avatar.thumb }));
  ta.classList.toggle("on", !!state.avatar);
  void quote();
  scheduleCheck();
}

function addRef(r: Ref) {
  const max = { image: 9, video: 3, audio: 3 }[r.kind];
  if (state.refs.filter((x) => x.kind === r.kind).length >= max) return msg(`At most ${max} ${r.kind} references.`, "err");
  if (state.refs.some((x) => x.id === r.id)) return;
  if (state.mode === "image" && r.kind === "image" && !state.refs.some((x) => x.role === "first_frame")) r.role = "first_frame";
  if (state.mode === "firstLast" && r.kind === "image") r.role = state.refs.some((x) => x.role === "first_frame") ? "last_frame" : "first_frame";
  state.refs.push(r);
  renderRefs();
}

/** Businesses and products, loaded after the controls are ready; the pickers wait for them. */
let dataReady: Promise<void> = Promise.resolve();

async function openPicker(kind: "refs" | "product" | "avatar") {
  const dlg = $("pickDlg") as HTMLDialogElement;
  const top = $("pickTop");
  const grid = $("pickGrid");
  top.replaceChildren();
  grid.replaceChildren(el("span", { className: "spin" }));
  $("pickTitle").textContent = kind === "product" ? "Choose a product" : kind === "avatar" ? "Choose a presenter" : "Add references";
  // Open at once; the choices fill in as they arrive.
  if (!dlg.open) dlg.showModal();
  await dataReady;
  if (kind === "product" || kind === "refs") {
    const sel = el("select", { style: "width:auto" });
    sel.append(...state.businesses.map((b) => new Option(b.name, b.id)));
    sel.value = state.businessId;
    top.append(sel);
    const show = async () => {
      state.businessId = sel.value;
      state.products = await api<Product[]>(`/api/products?business=${encodeURIComponent(sel.value)}`);
      grid.replaceChildren();
      if (kind === "refs") {
        const up = el("div", { className: "pk" }, el("div", { className: "plus", textContent: "+" }), el("span", { textContent: "Upload photo, video or audio" }));
        up.onclick = () => $<HTMLInputElement>("file").click();
        grid.append(up);
        const mine = await api<{ items: { id: string; engine: Engine; title: string; videoUrl: string | null }[] }>("/api/showcase");
        for (const v of mine.items.filter((x) => x.videoUrl).slice(0, 12)) {
          const pk = el("div", { className: "pk" }, el("video", { src: v.videoUrl as string, muted: true, preload: "metadata" }), el("span", { textContent: `🎬 ${v.title}` }));
          pk.onclick = () => {
            addRef({ id: `vid:${v.engine}:${v.id}`, kind: "video", thumb: null, label: `Video: ${v.title}` });
            dlg.close();
          };
          grid.append(pk);
        }
      }
      for (const p of state.products) {
        if (kind === "product") {
          const pk = el("div", { className: `pk${p.id === state.productId ? " on" : ""}` }, p.photos[0] ? el("img", { src: `/api/photo/${p.photos[0].assetId}?size=thumb` }) : el("div", { className: "plus", textContent: "—" }), el("span", { textContent: `${p.name}${p.price ? ` · ${p.price}` : ""}` }));
          pk.onclick = () => {
            state.productId = p.id;
            state.refs = state.refs.filter((r) => !r.id.startsWith("ph:"));
            for (const ph of p.photos.slice(0, 2)) addRef({ id: `ph:${ph.assetId}`, kind: "image", thumb: `/api/photo/${ph.assetId}?size=thumb`, label: `${p.name} photo${ph.description ? `: ${ph.description}` : ""}` });
            renderRefs();
            dlg.close();
          };
          grid.append(pk);
        } else {
          for (const ph of p.photos) {
            const pk = el("div", { className: "pk" }, el("img", { src: `/api/photo/${ph.assetId}?size=thumb` }), el("span", { textContent: p.name }));
            pk.onclick = () => {
              if (!state.productId) state.productId = p.id;
              addRef({ id: `ph:${ph.assetId}`, kind: "image", thumb: `/api/photo/${ph.assetId}?size=thumb`, label: `${p.name} photo${ph.description ? `: ${ph.description}` : ""}` });
              dlg.close();
            };
            grid.append(pk);
          }
        }
      }
    };
    sel.onchange = () => void show();
    await show();
  } else {
    const inf = await api<{ influencers: Influencer[]; actions: { id: string; text: string }[] }>("/api/influencers");
    grid.replaceChildren();
    const note = el("p", { className: "hint", textContent: state.engine === "seedance" ? "Seedance refuses real faces. Realistic AI presenters are photos (Gemini); a presenter shot is used as Image reference. Talking presenters from the BytePlus character library come next." : "Cartoon presenters are free and drawn by the engine. Realistic AI presenters are photos (15 credits each)." });
    top.append(note);
    if (state.engine === "claude") {
      for (const c of (state.o as Options).cast) {
        const pk = el("div", { className: `pk${state.avatar?.id === c.id ? " on" : ""}` }, el("div", { className: "plus", textContent: "✎" }), el("span", { textContent: `${c.name} (cartoon)` }));
        pk.onclick = () => {
          state.avatar = { kind: "cartoon", id: c.id, label: c.name, thumb: null };
          renderRefs();
          dlg.close();
        };
        grid.append(pk);
      }
    }
    for (const i of inf.influencers) {
      const pk = el("div", { className: `pk${state.avatar?.id === i.id ? " on" : ""}` }, i.portrait ? el("img", { src: `/api/influencers/${i.id}/portrait` }) : el("div", { className: "plus", textContent: i.name[0] }), el("span", { textContent: `${i.name}, ${i.age}${i.portrait ? "" : " · make portrait"}` }));
      pk.onclick = async () => {
        if (!i.portrait) {
          msg(`Making ${i.name}'s portrait…`);
          await api(`/api/influencers/${i.id}/portrait`, { method: "POST" }).catch((e: Error) => msg(e.message, "err"));
          return openPicker("avatar");
        }
        state.avatar = { kind: "influencer", id: i.id, label: i.name, thumb: `/api/influencers/${i.id}/portrait` };
        renderRefs();
        dlg.close();
        if (state.productId) {
          msg(`Making a shot of ${i.name} with the product (15 credits)…`);
          try {
            const out = await api<{ uploadId: string }>(`/api/influencers/${i.id}/shot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: state.businessId, productId: state.productId, action: "holding", ratio: "9:16" }) });
            addRef({ id: `up:${out.uploadId}`, kind: "image", thumb: `/api/photo/${out.uploadId}?size=thumb`, label: `${i.name} (AI presenter) holding the product` });
            msg(`${i.name}'s shot is in the references.`, "ok");
            await refreshWallet();
          } catch (e) {
            msg((e as Error).message, "err");
          }
        } else msg(`Pick a product, then choose ${i.name} again to make a shot with it.`);
      };
      grid.append(pk);
    }
  }
}

async function upload(file: File) {
  msg("Uploading…");
  try {
    const kind: RefKind = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image";
    const out = await api<{ id: string }>(kind === "image" ? "/api/upload" : "/api/media", { method: "POST", headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file });
    addRef({ id: `${kind === "image" ? "up" : "um"}:${out.id}`, kind, thumb: kind === "image" ? `/api/photo/${out.id}?size=thumb` : null, label: `Your ${kind}: ${file.name}` });
    msg("Added.", "ok");
  } catch (e) {
    msg((e as Error).message, "err");
  }
}

// ---- Generate --------------------------------------------------------------------------------------------------------

async function writeWithClaude() {
  if (!state.productId) return msg("Pick a product first (the PRODUCT tile).", "err");
  const b = $<HTMLButtonElement>("pWrite");
  b.disabled = true;
  msg("Claude is writing the shot list…");
  try {
    const out = await api<{ prompt: string; issues: Issue[]; fallback: string | null }>("/api/seedance/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: state.businessId, productId: state.productId, templateId: state.templateId, note: $<HTMLTextAreaElement>("prompt").value, seconds: state.seconds, ratio: state.ratio, audio: state.audio, references: state.refs.map((r) => ({ kind: r.kind, label: r.label })), presenter: state.avatar?.label ?? null }),
    });
    $<HTMLTextAreaElement>("prompt").value = out.prompt;
    msg(out.fallback ? `Claude could not be reached, so BuPulse's own shot plan was used: ${out.fallback}` : "Prompt written. Change anything, then Generate.", out.fallback ? "" : "ok");
    showIssues(out.issues ?? []);
    scheduleCheck();
  } catch (e) {
    msg((e as Error).message, "err");
  } finally {
    b.disabled = false;
  }
}

/** BuPulse's own shot plan (no AI, free, instant); each press tries another template of the same kind. */
async function quickPlan() {
  if (!state.productId) return msg("Pick a product first (the PRODUCT tile).", "err");
  try {
    const plan = await api<{ prompt: string; templateName: string; notes: string[] }>("/api/seedance/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId: state.businessId, productId: state.productId, templateId: state.planVariant ? null : state.templateId, variant: state.planVariant, seconds: state.seconds, ratio: state.ratio, audio: state.audio, fixedLens: state.fixedLens, references: state.refs.map((r) => ({ kind: r.kind, label: r.label })), presenter: state.avatar?.label ?? null }),
    });
    state.planVariant += 1;
    $<HTMLTextAreaElement>("prompt").value = plan.prompt;
    msg(`Quick plan: ${plan.templateName}.${plan.notes.length ? ` ${plan.notes.join(" ")}` : ""} Press again for another plan.`, "ok");
    scheduleCheck();
  } catch (e) {
    msg((e as Error).message, "err");
  }
}

/** Sends the prompt to Claude's Motion engine instead (the prompt stays as the brief). */
function asMotion(prompt: string) {
  $("drawer").classList.remove("open");
  state.open = null;
  setEngine("claude");
  $<HTMLTextAreaElement>("prompt").value = prompt;
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (!state.productId) {
    msg("Motion videos start from a product: pick one, then press Generate.", "ok");
    void openPicker("product");
    return;
  }
  void generate();
}

async function generate() {
  const go = $<HTMLButtonElement>("go");
  go.disabled = true;
  const prompt = $<HTMLTextAreaElement>("prompt").value.trim();
  try {
    if (state.engine === "seedance") {
      if (!prompt) throw new Error("Write a prompt, or press Quick plan or Write with Claude.");
      if ((state.mode === "edit" || state.mode === "extend") && !state.refs.some((r) => r.kind === "video")) throw new Error("Add the video to edit or extend as a reference (+ then My videos).");
      const errors = await checkSeedance();
      if (errors.length) throw new Error(`Fix this first: ${errors[0].message}`);
      msg(state.o?.seedanceReady ? "Sending to Seedance…" : "Making the free preview…");
      const out = await api<{ jobs: SdJob[] }>("/api/seedance/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(seedanceBody()) });
      const preview = out.jobs[0]?.status.startsWith("preview");
      msg(preview ? "Preview: Seedance arrives with the BytePlus key. This is the shot plan it will film, with the price; no credits were taken." : `Seedance is making ${out.jobs.length > 1 ? `${out.jobs.length} videos` : "your video"}. Usually 1 to 5 minutes; you can keep working.`, "ok");
      await loadGens();
      openDrawer(state.gens.find((g) => g.id === out.jobs[0].id) ?? null);
    } else {
      if (!state.productId) throw new Error("Pick a product (the PRODUCT tile).");
      msg(`Claude is designing ${state.versions > 1 ? `${state.versions} versions` : "the video"}… (about 1 to 2 minutes)`);
      const out = await api<{ jobs: ClaudeJob[]; error: string | null }>("/api/design", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: state.mode, businessId: state.businessId, productId: state.productId, photoIds: state.refs.filter((r) => r.kind === "image").map((r) => r.id.split(":")[1]), styleId: state.templateId, hookId: state.hookId, ratio: state.ratio, seconds: state.seconds, note: prompt, fixedLens: state.fixedLens, cartoonId: state.avatar?.kind === "cartoon" ? state.avatar.id : null, versions: state.versions }),
      });
      if (out.error) throw new Error(out.error);
      msg("Designed. Press a generation to play it and make the MP4.", "ok");
      await loadGens();
      openDrawer(state.gens.find((g) => g.id === out.jobs[0].id) ?? null);
    }
    await refreshWallet();
  } catch (e) {
    msg((e as Error).message, "err");
  } finally {
    go.disabled = false;
  }
}

// ---- Generations and the drawer ------------------------------------------------------------------------------------

const fullClaude = new Map<string, ClaudeJob>();
/** The jobs list leaves the design out; the first cards that still need drawing fetch it once. */
async function withSpecs(jobs: ClaudeJob[]): Promise<ClaudeJob[]> {
  const need = jobs.filter((j) => !j.video && j.status !== "failed" && j.styleId !== "sample").slice(0, 24);
  await Promise.all(need.filter((j) => !fullClaude.has(j.id)).map(async (j) => fullClaude.set(j.id, await api<ClaudeJob>(`/api/jobs/${j.id}`))));
  return jobs.map((j) => fullClaude.get(j.id) ?? j);
}

async function loadGens() {
  const [cl0, sd] = await Promise.all([api<{ jobs: ClaudeJob[] }>("/api/jobs"), api<{ jobs: SdJob[] }>("/api/seedance/jobs")]);
  const cl = { jobs: await withSpecs(cl0.jobs) };
  const gens: Gen[] = [
    ...sd.jobs.map((j): Gen => ({ engine: "seedance", id: j.id, title: j.title, status: j.status, at: j.createdAt, videoUrl: j.videoFile ? `/videos/seedance/${j.id}.mp4` : null, sd: j })),
    ...cl.jobs.filter((j) => j.styleId !== "sample").map((j): Gen => ({ engine: "claude", id: j.id, title: j.productName, status: j.status === "failed" ? "failed" : j.video ? "succeeded" : "designed", at: j.createdAt, videoUrl: j.video ? `/videos/${j.id}.mp4` : null, claude: j })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  state.gens = gens;
  const grid = $("genGrid");
  $("gens").hidden = gens.length === 0;
  grid.replaceChildren();
  for (const g of gens.slice(0, 24)) {
    const card = el("div", { className: "genCard" });
    card.dataset.id = g.id;
    if (g.videoUrl) {
      const v = el("video", { src: g.videoUrl, muted: true, loop: true, playsInline: true, preload: "metadata" });
      card.onmouseenter = () => void v.play().catch(() => undefined);
      card.onmouseleave = () => v.pause();
      card.append(v);
    } else if (g.engine === "claude" && g.claude?.spec) {
      const c = el("canvas");
      const size = canvasSize(g.claude.spec, "480p");
      c.width = size.width;
      c.height = size.height;
      card.append(c);
      void loadPhotos((g.claude.photoIds ?? []).map((id) => `/api/photo/${id}?size=thumb`)).then((ph) => drawSpecFrame(c.getContext("2d") as CanvasRenderingContext2D, g.claude?.spec as MotionSpec, ph, 1500, { quality: "480p" }));
    } else if (g.sd?.preview) {
      // A free preview (no BytePlus key yet): its first storyboard frame, or a spinner while it is drawn.
      if (g.status === "preview-ready") {
        const img = el("img", { className: "frame", alt: "Storyboard" });
        card.append(img);
        void storyboard(g.id).then((sb) => sb?.frames[0] && (img.src = svgSrc(sb.frames[0].svg)));
      } else card.append(el("div", { className: "wait" }, el("span", { className: "spin" }), el("span", { textContent: "Drawing the storyboard…" })));
    } else {
      card.append(el("div", { className: "wait" }, g.status === "failed" || g.status === "cancelled" ? el("span", { textContent: g.sd?.error ?? g.claude?.error ?? g.status }) : el("span", { className: "spin" }), el("span", { textContent: g.status === "queued" ? "Queued at Seedance" : g.status === "running" ? "Seedance is filming…" : g.status })));
    }
    card.append(el("span", { className: `st ${g.status}`, textContent: g.sd?.preview ? "Seedance preview" : g.engine === "seedance" ? "Seedance" : "Motion" }), el("div", { className: "cap", textContent: g.title }));
    card.onclick = () => openDrawer(g);
    grid.append(card);
  }
}

/** SVG frames are shown as images, so nothing inside them can run. */
const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const storyboards = new Map<string, Storyboard>();
async function storyboard(id: string): Promise<Storyboard | null> {
  if (storyboards.has(id)) return storyboards.get(id) as Storyboard;
  const pv = await api<PreviewAnswer>(`/api/seedance/jobs/${id}/preview`).catch(() => null);
  if (!pv?.ready) return null;
  storyboards.set(id, pv.storyboard);
  return pv.storyboard;
}

/** The drawer for a free Seedance preview: waits for the storyboard, then shows its frames, shots and price. */
async function showPreview(g: Gen, j: SdJob) {
  const media = $("dMedia");
  const pv = await api<PreviewAnswer>(`/api/seedance/jobs/${j.id}/preview`).catch((e: Error) => {
    media.replaceChildren(el("p", { className: "err", textContent: e.message }));
    return null;
  });
  if (!pv || state.open !== g) return;
  if (!pv.ready) {
    media.replaceChildren(el("div", { className: "wait", style: "padding:40px;text-align:center" }, el("span", { className: "spin" }), el("div", { className: "muted", textContent: "Drawing the storyboard Seedance will film…" })));
    setTimeout(async () => {
      if (state.open?.id !== j.id) return;
      await loadGens();
      openDrawer(state.gens.find((x) => x.id === j.id) ?? null);
    }, Math.max(800, pv.readyInMs + 300));
    return;
  }
  const sb = pv.storyboard;
  storyboards.set(j.id, sb);
  const frames = el("div", { className: "frames" }, ...sb.frames.map((f) => el("figure", {}, el("img", { src: svgSrc(f.svg), alt: f.caption }), el("figcaption", { textContent: f.caption }))));
  const shots = el("table", { className: "shots" }, el("tr", {}, ...["Time", "Shot", "Camera", "What happens"].map((h) => el("th", { textContent: h }))));
  for (const sh of sb.shots) {
    const what = el("td", {}, sh.action);
    if (sh.spoken) what.append(el("div", { className: "muted", textContent: `Says: "${sh.spoken}"` }));
    if (sh.sound) what.append(el("div", { className: "muted", textContent: `Sound: ${sh.sound}` }));
    if (sh.references.length) what.append(el("div", { className: "muted", textContent: `Uses: ${sh.references.join(", ")}` }));
    shots.append(el("tr", {}, el("td", { textContent: `${sh.from}–${sh.to} s` }), el("td", { textContent: sh.shot }), el("td", { textContent: sh.camera }), what));
  }
  media.replaceChildren(el("div", { className: "pvNotice", textContent: sb.notice }), frames, ...(sb.setting ? [el("p", { className: "muted small", textContent: `Setting: ${sb.setting}` })] : []), shots);
  if (sb.issues.length) media.append(el("div", { className: "checks" }, ...sb.issues.filter((i) => i.level !== "info").map((i) => el("div", { className: `issue ${i.level}`, textContent: i.message }))));
  $("dInfo").replaceChildren(
    ...([
      ["Status", "Preview (free)"],
      ["Model", `${sb.model} · ${sb.resolution} · ${sb.seconds} s · ${sb.ratio}${sb.audio ? " · sound" : ""}`],
      ["With the key it costs", `${sb.estimate.credits} credits (${(sb.estimate.credits * 10).toLocaleString()} RWF), about $${sb.estimate.usd.toFixed(2)}`],
      ["Usual wait", sb.estimate.wait],
    ] as [string, string][]).flatMap(([k, v]) => [el("span", { className: "k", textContent: k }), el("span", { textContent: v })]),
  );
  const motion = el("button", { className: "btn sm primary", textContent: "Make it as a Motion video instead" });
  motion.onclick = () => asMotion(j.request.prompt);
  const edit = el("button", { className: "btn sm", textContent: "Edit the prompt" });
  edit.onclick = () => {
    $<HTMLTextAreaElement>("prompt").value = j.request.prompt;
    $("drawer").classList.remove("open");
    state.open = null;
    window.scrollTo({ top: 0, behavior: "smooth" });
    scheduleCheck();
  };
  $("dActions").replaceChildren(motion, edit);
}

let drawerAnim = 0;
function openDrawer(g: Gen | null) {
  if (!g) return;
  state.open = g;
  const d = $("drawer");
  d.classList.add("open");
  $("dTitle").textContent = `${g.engine === "seedance" ? "Seedance" : "Motion"} · ${g.title}`;
  const media = $("dMedia");
  media.replaceChildren();
  const dl = $<HTMLAnchorElement>("dDl");
  dl.hidden = !g.videoUrl;
  if (g.videoUrl) {
    dl.href = g.videoUrl;
    dl.download = `bupulse-${g.id}.mp4`;
  }
  $("dMsg").textContent = "";
  $("dProgress").hidden = true;
  const actions = $("dActions");
  actions.replaceChildren();
  $("dEdit").hidden = true;
  const info: [string, string][] = [];
  cancelAnimationFrame(drawerAnim);
  if (g.engine === "seedance" && g.sd?.preview) {
    $("dPrompt").textContent = g.sd.request.prompt;
    void showPreview(g, g.sd);
    return;
  } else if (g.engine === "seedance" && g.sd) {
    const j = g.sd;
    if (g.videoUrl) media.append(el("video", { src: g.videoUrl, controls: true, autoplay: true, loop: true, playsInline: true }));
    else media.append(el("div", { className: "wait", style: "padding:40px;text-align:center" }, el("span", { className: "spin" }), el("div", { className: "muted", textContent: j.error ?? (j.status === "queued" ? "Queued at Seedance…" : j.status === "running" ? "Seedance is filming… this page updates by itself." : j.status) })));
    info.push(["Status", j.status], ["Quality", `${j.request.tier} · ${j.request.resolution} · ${j.request.seconds} s · ${j.request.ratio}`], ["Credits", String(j.credits)], ["Provider cost", j.costUsd ? `$${j.costUsd.toFixed(3)} (${j.tokens.toLocaleString()} tokens)` : `about $${j.estimateUsd.toFixed(2)}`]);
    if (j.status === "queued") {
      const c = el("button", { className: "btn sm", textContent: "Cancel (refund)" });
      c.onclick = async () => {
        await api(`/api/seedance/jobs/${j.id}/cancel`, { method: "POST" });
        await loadGens();
        openDrawer(state.gens.find((x) => x.id === j.id) ?? null);
      };
      actions.append(c);
    }
    if (g.videoUrl) {
      const use = el("button", { className: "btn sm", textContent: "Use as Video reference" });
      use.onclick = () => {
        addRef({ id: `vid:seedance:${j.id}`, kind: "video", thumb: null, label: `Video: ${j.title}` });
        msg("Added as a video reference: choose Edit or Extend in Mode and describe the change.", "ok");
      };
      actions.append(use);
      $("dEdit").hidden = false;
      $("dEditBtn").onclick = () => {
        state.engine = "seedance";
        state.mode = "edit";
        state.refs = [{ id: `vid:seedance:${j.id}`, kind: "video", thumb: null, label: `Video: ${j.title}` }];
        $<HTMLTextAreaElement>("prompt").value = $<HTMLTextAreaElement>("dEditNote").value;
        renderPills();
        renderRefs();
        void generate();
      };
      $("dExtendBtn").onclick = () => {
        state.engine = "seedance";
        state.mode = "extend";
        state.refs = [{ id: `vid:seedance:${j.id}`, kind: "video", thumb: null, label: `Video: ${j.title}` }];
        $<HTMLTextAreaElement>("prompt").value = `Extend Video 1 by 5 seconds: ${$<HTMLTextAreaElement>("dEditNote").value || "continue the scene naturally and end on the product"}`;
        renderPills();
        renderRefs();
        void generate();
      };
    }
    $("dPrompt").textContent = j.request.prompt;
  } else if (g.claude) {
    const j = g.claude;
    if (j.spec) {
      const spec = j.spec;
      const c = el("canvas");
      const size = canvasSize(spec, "720p");
      c.width = size.width;
      c.height = size.height;
      media.append(c);
      const ctx = c.getContext("2d") as CanvasRenderingContext2D;
      void Promise.all([loadPhotos(j.photoIds.map((id) => `/api/photo/${id}`)), loadSpecFonts(spec)]).then(([ph]) => {
        state.photos = ph;
        let last = performance.now();
        let t = 0;
        const total = totalMs(spec);
        const loop = (now: number) => {
          if (state.open !== g) return;
          t = (t + now - last) % total;
          last = now;
          drawSpecFrame(ctx, spec, ph, t, { quality: "720p" });
          drawerAnim = requestAnimationFrame(loop);
        };
        drawerAnim = requestAnimationFrame(loop);
      });
      const mk = el("button", { className: "btn sm primary", textContent: `Make MP4 (${state.quality}${state.voice ? " + voice-over" : ""})` });
      mk.onclick = () => void makeMp4(g);
      actions.append(mk);
      $("dEdit").hidden = false;
      $("dEditBtn").onclick = () => void editClaude(g, "edit");
      $("dExtendBtn").onclick = () => void editClaude(g, "extend");
      info.push(["Length", `${(totalMs(spec) / 1000).toFixed(1)} s · ${spec.scenes.length} scenes`], ["Camera", [...new Set(spec.scenes.map((s) => s.camera?.move ?? "static"))].join(", ")], ["Look", spec.look?.grade ?? "none"], ["API-equivalent cost", `$${(j.apiEquivalentUsd ?? 0).toFixed(3)}`]);
      const v = voices.get(j.id);
      if (v) info.push(["Voice-over", `spoken in ${v.spokenLanguage}${v.fits ? "" : ", cut to fit 30 s"}`]);
      $("dPrompt").textContent = `${spec.caption}\n\n${spec.hashtags.map((h) => `#${h}`).join(" ")}`;
    } else {
      media.append(el("div", { className: "muted", textContent: j.error ?? "This design failed." }));
    }
  }
  $("dInfo").replaceChildren(...info.flatMap(([k, v]) => [el("span", { className: "k", textContent: k }), el("span", { textContent: v })]));
}

/** The voice-over each design was rendered with in this visit (for the drawer's info rows). */
const voices = new Map<string, { spokenLanguage: string; fits: boolean }>();

async function makeMp4(g: Gen) {
  const j = g.claude;
  if (!j?.spec) return;
  const bar = $("dProgress");
  bar.hidden = false;
  const fill = bar.firstElementChild as HTMLElement;
  $("dMsg").textContent = "Making the MP4 in this browser…";
  try {
    const track = j.spec.music ? await api<{ id: string } | null>(`/api/music?mood=${encodeURIComponent(j.spec.music)}`).catch(() => null) : null;
    // The voice-over first (the design may be stretched to fit the lines); without it the MP4 is still made.
    let spec = j.spec;
    let voice: { url: string; cues: VoiceCue[] } | null = null;
    const notes: string[] = [];
    if (state.voice) {
      $("dMsg").textContent = "Recording the voice-over…";
      try {
        const out = await api<{ voice: { url: string; cues: VoiceCue[]; spec: MotionSpec; fits: boolean; note: string | null; cached: boolean; spokenLanguage: string } | null; credits: number }>(`/api/jobs/${j.id}/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        if (out.voice) {
          spec = out.voice.spec;
          voice = { url: out.voice.url, cues: out.voice.cues };
          voices.set(j.id, { spokenLanguage: out.voice.spokenLanguage, fits: out.voice.fits });
          notes.push(out.voice.cached ? "Voice-over reused (free)." : `Voice-over: ${out.credits} credits.`);
          if (!out.voice.fits) notes.push("Voice cut to fit 30 s.");
          if (out.voice.note) notes.push(out.voice.note);
        } else notes.push("This design has no voice lines, so no voice-over (no credits taken).");
        await refreshWallet();
      } catch (e) {
        notes.push(`No voice-over: ${(e as Error).message} The MP4 is made without voice.`);
      }
      $("dMsg").textContent = `${notes.join(" ")} Making the MP4 in this browser…`;
    }
    const started = performance.now();
    const blob = await encodeSpecMp4(spec, state.photos, { musicUrl: track ? `/api/music/${track.id}` : null, voice, quality: state.quality, onProgress: (f) => (fill.style.width = `${Math.round(f * 100)}%`) });
    await api(`/api/jobs/${j.id}/video?ms=${Math.round(performance.now() - started)}&q=${state.quality}`, { method: "POST", headers: { "content-type": "video/mp4" }, body: blob });
    $("dMsg").textContent = `MP4 ready (${(blob.size / 1024 / 1024).toFixed(1)} MB). ${notes.join(" ")}`;
    await loadGens();
    openDrawer(state.gens.find((x) => x.id === g.id) ?? null);
  } catch (e) {
    $("dMsg").textContent = (e as Error).message;
  } finally {
    bar.hidden = true;
    fill.style.width = "0";
  }
}

async function editClaude(g: Gen, mode: "edit" | "extend") {
  const note = $<HTMLTextAreaElement>("dEditNote").value.trim();
  if (mode === "edit" && !note) return void ($("dMsg").textContent = "Describe the change first.");
  $("dMsg").textContent = mode === "edit" ? "Claude is changing the video…" : "Claude is extending the video…";
  try {
    const out = await api<{ jobs: ClaudeJob[]; error: string | null }>("/api/design", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, baseJobId: g.id, note, seconds: 5 }) });
    if (out.error) throw new Error(out.error);
    await loadGens();
    openDrawer(state.gens.find((x) => x.id === out.jobs[0].id) ?? null);
    await refreshWallet();
  } catch (e) {
    $("dMsg").textContent = (e as Error).message;
  }
}

// ---- Templates and carousel ------------------------------------------------------------------------------------------

const previewPhotos = new Map<string, Promise<Map<number, Img>>>();
const photosFor = (ids: string[]) => {
  const key = ids.join(",");
  if (!previewPhotos.has(key)) previewPhotos.set(key, loadPhotos(ids.map((id) => `/api/photo/${id}?size=thumb`)));
  return previewPhotos.get(key) as Promise<Map<number, Img>>;
};

function renderTemplates() {
  const o = state.o as Options;
  const cats = [{ id: "all", name: "All" }, ...o.categories];
  $("cats").replaceChildren(
    ...cats.map((c) => {
      const b = el("button", { className: `btn sm${c.id === state.category ? " on" : ""}`, textContent: categoryName(c.id, c.name) });
      b.onclick = () => {
        state.category = c.id;
        renderTemplates();
      };
      return b;
    }),
  );
  const q = $<HTMLInputElement>("tsearch").value.trim().toLowerCase();
  const grid = $("tgrid");
  grid.replaceChildren();
  for (const t of o.templates.filter((t) => (state.category === "all" || t.category === state.category) && (!q || `${t.name} ${t.blurb}`.toLowerCase().includes(q)))) {
    const thumb = el("div", { className: "thumb" }, el("span", { className: "cat", textContent: categoryName(t.category, o.categories.find((c) => c.id === t.category)?.name ?? "") }));
    const card = el("button", { className: `tcard${t.id === state.templateId ? " on" : ""}` }, thumb, el("div", { className: "nm" }, el("b", { textContent: t.name }), el("span", { textContent: t.blurb })));
    card.onclick = () => {
      state.templateId = t.id;
      if (t.seconds && state.engine === "claude") state.seconds = t.seconds;
      if (t.hook) state.hookId = t.hook;
      renderPills();
      renderTemplates();
      msg(`Template: ${t.name}. ${state.engine === "seedance" ? "Press Write with Claude to turn it into a Seedance prompt for your product." : ""}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const pv = state.previews[t.id];
    if (pv) void mountPreview(thumb, pv, card);
    grid.append(card);
  }
}

async function mountPreview(host: HTMLElement, pv: Preview, card: HTMLElement) {
  const size = canvasSize(pv.spec, "480p");
  const c = el("canvas", { width: size.width, height: size.height });
  host.prepend(c);
  const g = c.getContext("2d") as CanvasRenderingContext2D;
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

function carousel(items: { videoUrl: string; title: string; engine: Engine }[]) {
  const box = $("carousel");
  box.replaceChildren();
  if (!items.length) {
    box.style.height = "40px";
    return;
  }
  const cards = items.slice(0, 7).map((i) => {
    const c = el("a", { className: "cardV", href: "/showcase" }, el("video", { src: i.videoUrl, muted: true, loop: true, playsInline: true, autoplay: true, preload: "metadata" }), el("span", { className: "lbl", textContent: i.engine === "seedance" ? "Real video" : "Motion" }));
    box.append(c);
    return c;
  });
  let centre = 0;
  const place = () => {
    cards.forEach((c, k) => {
      const d = ((k - centre) % cards.length + cards.length) % cards.length;
      const off = d > cards.length / 2 ? d - cards.length : d;
      const a = Math.abs(off);
      c.style.transform = `translateX(${off * 250}px) scale(${1 - a * 0.12}) rotateY(${-off * 8}deg)`;
      c.style.opacity = a > 2 ? "0" : String(1 - a * 0.25);
      c.style.zIndex = String(10 - a);
      c.style.filter = a ? "brightness(.6)" : "none";
    });
  };
  place();
  setInterval(() => {
    centre = (centre + 1) % cards.length;
    place();
  }, 3500);
}

// ---- Start -----------------------------------------------------------------------------------------------------------

async function start() {
  const o = await api<Options>("/api/options");
  state.o = o;
  const q = new URLSearchParams(location.search);
  if (q.get("engine") === "claude") {
    state.engine = "claude";
    state.seconds = 15;
    document.querySelectorAll<HTMLButtonElement>("#engineSw button").forEach((b) => b.classList.toggle("on", b.dataset.engine === "claude"));
  }
  if (q.get("tier")) state.tier = q.get("tier") as string;
  // A model page (/app/video/<model>) preselects its engine and quality.
  const model = modelById(document.body.dataset.model);
  if (model?.engine === "claude") {
    state.engine = "claude";
    state.seconds = 15;
    // The Claude 3D motion page opens on the 3D templates, the first one chosen.
    const featured = model.featureCategory ? o.templates.find((t) => t.category === model.featureCategory) : undefined;
    if (featured) {
      state.category = featured.category;
      state.templateId = featured.id;
      if (featured.seconds) state.seconds = featured.seconds;
      if (featured.hook) state.hookId = featured.hook;
    }
  } else if (model?.tier) {
    state.engine = "seedance";
    state.tier = model.tier;
  }
  document.querySelectorAll<HTMLButtonElement>("#engineSw button").forEach((b) => b.classList.toggle("on", b.dataset.engine === state.engine));
  const allowed = o.seedance.tiers.find((t) => t.id === state.tier)?.resolutions ?? [];
  if (allowed.length && !allowed.includes(state.resolution)) state.resolution = allowed[allowed.length - 1];
  if (q.get("prompt")) $<HTMLTextAreaElement>("prompt").value = (q.get("prompt") as string).slice(0, 4000);
  if (!o.seedanceReady && state.engine === "seedance") msg("Seedance is waiting for the BytePlus key: set everything up now; Generate shows what it will make, or makes it as a Motion video.");
  // The controls work at once; the products and template previews (slower, from the database) follow.
  setupPills();
  // ?ref=<upload id> (an AI image's "Use in a video"): that image is the first reference.
  const ref = q.get("ref");
  if (ref && /^up-[0-9a-f]{12}$/.test(ref)) state.refs.push({ id: `up:${ref}`, kind: "image", thumb: `/api/photo/${ref}?size=thumb`, label: "AI image (Nano Banana)" });
  renderPills();
  renderRefs();
  dataReady = (async () => {
    state.businesses = await api<{ id: string; name: string }[]>("/api/businesses");
    state.businessId = state.businesses[0]?.id ?? "";
    state.products = state.businessId ? await api<Product[]>(`/api/products?business=${encodeURIComponent(state.businessId)}`) : [];
  })();
  if (location.hash === "#influencers") void openPicker("avatar");
  wireExamples((text) => {
    $<HTMLTextAreaElement>("prompt").value = text;
    window.scrollTo({ top: 0, behavior: "smooth" });
    msg("Example prompt added. Change it for your product, then Generate.", "ok");
  });
  void loadPricing()
    .then((p) => {
      state.claudeCredits = p.claudeCredits;
      state.voiceCredits = p.voiceCredits ?? state.voiceCredits;
    })
    .catch(() => undefined);
  $<HTMLInputElement>("tsearch").oninput = renderTemplates;
  window.addEventListener("studio:lang", renderTemplates);
  $("go").onclick = () => void generate();
  $("pickClose").onclick = () => ($("pickDlg") as HTMLDialogElement).close();
  $("dClose").onclick = () => {
    $("drawer").classList.remove("open");
    state.open = null;
  };
  $<HTMLInputElement>("file").onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void upload(f);
    (e.target as HTMLInputElement).value = "";
  };
  state.previews = await api<Record<string, Preview>>("/api/template-previews").catch(() => ({}));
  renderTemplates();
  if (location.hash === "#tgrid") document.getElementById("tgrid")?.scrollIntoView({ block: "start" });
  await dataReady;
  renderRefs();
  await loadGens();
  const show = await api<{ items: { id: string; engine: Engine; title: string; videoUrl: string | null }[] }>("/api/showcase");
  carousel(show.items.filter((i) => i.videoUrl).map((i) => ({ videoUrl: i.videoUrl as string, title: i.title, engine: i.engine })));
  setInterval(async () => {
    if (state.gens.some((g) => g.engine === "seedance" && (g.status === "queued" || g.status === "running" || g.status === "submitting" || g.status === "preview"))) {
      await loadGens();
      if (state.open?.engine === "seedance") openDrawer(state.gens.find((g) => g.id === state.open?.id) ?? null);
      await refreshWallet();
    }
  }, 10_000);
}
void start().catch((e) => msg((e as Error).message, "err"));
