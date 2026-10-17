// The Create page (docs/VIDEO_ENGINE.md, "Studio"): one prompt bar for both engines, in the style of Higgsfield's
// Marketing Studio and Seedance's app. Real video goes to BytePlus through the lab server (submit, then poll);
// Motion videos are designed by Claude and drawn here (lib/video-engine), with the MP4 made in this browser.
// The model pages (/app/video/<model>) are this page with the model preselected (body data-model, models.json).
import { drawSpecFrame, type Photos } from "@/lib/video-engine/draw";
import { encodeSpecMp4, loadPhotos, loadSpecFonts } from "@/lib/video-engine/encode";
import { canvasSize, totalMs, type MotionSpec, type Quality } from "@/lib/video-engine/spec";
import { openVideoFrames } from "@/lib/video-engine/video-frames";
import type { VoiceCue } from "@/lib/video-engine/voice";
import { carousel } from "./carousel";
import { categoryName, translate } from "./i18n";
import { setupInspire, showInspire } from "./inspire";
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
type FactWarning = { where: string; found: string; problem: "not-in-brief" | "business-only"; message: string };
type DesignScore = { score: number; failed: { rule: string; reason: string; scene?: number | null }[] };
type ClaudeJob = { businessId?: string; productId?: string; purpose?: "ad" | "post"; warnings?: FactWarning[]; score?: DesignScore; captionScore?: number; captionMissed?: string[]; id: string; createdAt: string; productName: string; styleId: string; ratio: string; photoIds: string[]; spec: MotionSpec | null; usage: unknown[]; apiEquivalentUsd?: number; status: string; error: string | null; video: { bytes: number; quality?: string } | null; mode?: string };
type SdJob = { businessId?: string | null; productId?: string | null; id: string; createdAt: string; status: string; credits: number; estimateUsd: number; costUsd: number; tokens: number; videoFile: string | null; error: string | null; title: string; request: { prompt: string; tier: string; resolution: string; ratio: string; seconds: number; referenceNotes: string[] }; preview?: { notice: string; readyAt: string; wouldCostCredits: number } };
/** An opening line from the Brain (lib/video-engine/brain/suggest.ts). */
type HookSuggestion = { hookId: string; name: string; line: string; why: string };
type Issue = { level: "error" | "warning" | "info"; code: string; message: string };
type StoryShot = { n: number; from: number; to: number; shot: string; camera: string; action: string; sound: string | null; spoken: string | null; references: string[] };
type Storyboard = { notice: string; model: string; resolution: string; ratio: string; seconds: number; audio: boolean; setting: string | null; shots: StoryShot[]; frames: { at: number; shot: number; caption: string; svg: string }[]; references: { label: string; kind: string; thumb: string | null }[]; estimate: { usd: number; credits: number; wait: string }; issues: Issue[] };
type PreviewAnswer = { ready: false; readyInMs: number; notice: string } | { ready: true; storyboard: Storyboard };
/** A Premium 3D clip (Blender), video-lab/premium-jobs.ts. */
type PremiumJob = { quality?: string; parentId?: string | null; repairs?: string[]; photoFiles?: unknown[]; audio?: { voice: boolean; music: boolean; voiceFile: string | null; voiceNote: string | null; musicTitle: string | null }; id: string; createdAt: string; status: "designing" | "voicing" | "rendering" | "succeeded" | "failed"; progress: number; credits: number; title: string; seconds: number; caption: string | null; hashtags: string[]; say: string | null; warnings: FactWarning[]; renderSeconds: number | null; videoFile: string | null; error: string | null };
type Gen = { engine: Engine; id: string; title: string; status: string; at: string; videoUrl: string | null; claude?: ClaudeJob; sd?: SdJob; pm?: PremiumJob };
type Product = { id: string; name: string; summary: string; price: string | null; photos: { assetId: string; description: string | null; cutout?: boolean | null }[] };
/** A ModelArk digital character (lib/video-engine/seedance-characters.ts): a presenter Seedance accepts. */
type Character = { id: string; name: string; description: string; uri: string; portraitUrl: string | null; source: "byteplus" | "picked" | "preview" };
type Preview = { spec: MotionSpec; photoIds: string[] };
type Influencer = { id: string; name: string; age: number; vibe: string; portrait: boolean; shots: { id: string; product: string; action: string }[] };

/** Where a Motion video will be posted (lib/video-engine/designer.ts PLATFORMS); "" = any. */
const PLATFORMS = [
  { id: "", name: "Any platform" },
  { id: "instagram", name: "Instagram" },
  { id: "tiktok", name: "TikTok" },
  { id: "facebook", name: "Facebook" },
  { id: "youtube", name: "YouTube Shorts" },
];
const SEEDANCE_SECONDS = [4, 5, 6, 8, 10, 12, 15];
const PREMIUM_SECONDS = [4, 5, 6, 8];
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
  /** Motion's "Premium 3D (Blender)" quality: Claude designs a Blender scene, rendered on the studio computer. */
  premium: false,
  blender: { available: false, credits: { "540p": 100, "720p": 150, rerender: 70 }, sound: false, voiceReady: false, voiceCredits: 15 },
  premiumQuality: "540p" as "540p" | "720p",
  /** Premium 3D sound (once Blender mixes it): the ElevenLabs voice-over of the scene's line, and library music. */
  premiumVoice: true,
  premiumMusic: true,
  voiceCredits: 15,
  planVariant: 0,
  checkErrors: [] as Issue[],
  photos: new Map() as Photos,
  /** The Brain's opening lines for the product (Motion), and the one the owner clicked. */
  hooks: [] as HookSuggestion[],
  chosenHook: null as HookSuggestion | null,
  hooksKey: "",
  /** Motion videos: an ad (price, how to order) or an organic post on the business's page. */
  purpose: "ad" as "ad" | "post",
  /** Motion videos: where the video will be posted (optional; null = any). */
  platform: null as string | null,
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
  $("pQualityV").textContent = sd ? `${o.seedance.tiers.find((t) => t.id === state.tier)?.name.replace("Seedance 2.0 ", "") || "Pro"} · ${state.resolution}` : state.premium ? `Premium 3D · ${state.premiumQuality}` : state.quality;
  $("pVersionsV").textContent = `${state.versions}/4`;
  $("go").className = `genBtn${sd ? " bp" : ""}`;
  $("pWrite").hidden = !sd;
  $("pPlan").hidden = !sd;
  $("pPlatform").hidden = sd;
  $("pPurpose").hidden = sd;
  $("pPurpose").textContent = state.purpose === "post" ? "Post" : "Ad";
  $("pPurpose").classList.toggle("on", state.purpose === "post");
  $("pPlatformV").textContent = PLATFORMS.find((x) => x.id === state.platform)?.name ?? "Any platform";
  $("tAvatar").hidden = false;
  void quote();
  scheduleCheck();
  void loadHooks();
}

// ---- Opening lines (the Brain's suggestions, Motion only for now) -----------------------------------------------------

/** Fetches the three opening lines when the product, template, platform or length changes. */
async function loadHooks() {
  const box = $("hookChips");
  if (state.engine !== "claude" || !state.productId) {
    box.hidden = true;
    return;
  }
  const key = [state.businessId, state.productId, state.templateId, state.platform, state.seconds, state.purpose].join("|");
  if (key === state.hooksKey) return renderHooks();
  state.hooksKey = key;
  const q = new URLSearchParams({ business: state.businessId, product: state.productId, template: state.templateId, seconds: String(state.seconds), platform: state.platform ?? "", purpose: state.purpose });
  const out = await api<{ hooks: HookSuggestion[] }>(`/api/hooks?${q}`).catch(() => ({ hooks: [] as HookSuggestion[] }));
  if (key !== state.hooksKey) return;
  state.hooks = out.hooks;
  if (state.chosenHook && !out.hooks.some((h) => h.line === state.chosenHook?.line)) state.chosenHook = null;
  renderHooks();
}

function renderHooks() {
  const box = $("hookChips");
  box.hidden = state.engine !== "claude" || !state.hooks.length;
  const plan = el("button", { className: "hookChip plan", textContent: "📅 Plan a week", title: "Seven different posts for this product, one a day (free to plan; each video costs the usual credits)" });
  plan.onclick = () => void planWeek();
  box.replaceChildren(
    el("span", { className: "muted small", textContent: "Opening line:" }),
    ...state.hooks.map((h) => {
      const on = state.chosenHook?.line === h.line;
      const b = el("button", { className: `hookChip${on ? " on" : ""}`, textContent: h.line, title: `${h.name}. ${h.why}` });
      b.onclick = () => {
        // A second click lets Claude choose again.
        state.chosenHook = on ? null : h;
        if (!on) state.hookId = h.hookId;
        renderHooks();
        msg(on ? "Claude will choose the opening line." : `Opening line: "${h.line}". ${h.why}`, "ok");
      };
      return b;
    }),
    plan,
  );
}

// ---- Plan a week (the Brain's planSeries) -----------------------------------------------------------------------------

type SeriesPost = { day: number; date: string | null; weekday: string | null; platform: string; hookId: string; line: string; templateId: string; seconds: number; voice: boolean; note: string; why: string };
const PLATFORM_NAMES: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube Shorts" };

/** Seven distinct posts for the product (free); each row's Generate makes it as a normal Motion design. */
async function planWeek() {
  const dlg = $("planDlg") as HTMLDialogElement;
  const table = $("planTable");
  const product = state.products.find((x) => x.id === state.productId);
  $("planTitle").textContent = `Plan a week${product ? `: ${product.name}` : ""}`;
  $("planNote").textContent = "Free to plan. Each Generate makes that day's video as a Motion design (the usual credits).";
  table.replaceChildren(el("tr", {}, el("td", {}, el("span", { className: "spin" }))));
  if (!dlg.open) dlg.showModal();
  const q = new URLSearchParams({ business: state.businessId, product: state.productId, template: state.templateId, seconds: String(state.seconds), platform: state.platform ?? "", purpose: state.purpose, presenter: state.avatar ? "1" : "0" });
  let posts: SeriesPost[] = [];
  try {
    posts = (await api<{ posts: SeriesPost[] }>(`/api/plan?${q}`)).posts;
  } catch (e) {
    table.replaceChildren(el("tr", {}, el("td", { className: "err", textContent: (e as Error).message })));
    return;
  }
  const o = state.o as Options;
  table.replaceChildren(el("tr", {}, ...["Day", "Platform", "Opening line", "Template", "Length", "Note", ""].map((h) => el("th", { textContent: h }))));
  for (const post of posts) {
    const go = el("button", { className: "btn sm primary", textContent: `Generate (${state.claudeCredits || "…"})` });
    go.onclick = () => {
      dlg.close();
      // The row fills the form, then it is made like any Motion design.
      setEngine("claude");
      state.templateId = post.templateId;
      state.platform = post.platform && post.platform !== "any" ? post.platform : null;
      state.seconds = post.seconds;
      state.voice = post.voice;
      state.hookId = post.hookId;
      state.chosenHook = { hookId: post.hookId, name: "", line: post.line, why: post.why };
      renderPills();
      renderTemplates();
      void generate();
    };
    table.append(
      el(
        "tr",
        {},
        el("td", { textContent: post.weekday ? `${post.weekday.slice(0, 3)} ${post.date?.slice(5) ?? ""}` : `Day ${post.day}` }),
        el("td", { textContent: PLATFORM_NAMES[post.platform] ?? "Any" }),
        el("td", { textContent: post.line, title: post.why }),
        el("td", { textContent: o.templates.find((t) => t.id === post.templateId)?.name ?? post.templateId }),
        el("td", { textContent: `${post.seconds} s${post.voice ? " · voice" : ""}` }),
        el("td", { className: "muted small", textContent: post.note }),
        el("td", {}, go),
      ),
    );
  }
  if (!posts.length) table.append(el("tr", {}, el("td", { className: "muted", textContent: "This product has too few facts for a week of different posts yet. Add a price, a phone number or more details." })));
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
    const out = await api<{ ok: boolean; issues: Issue[]; problems?: string[] }>("/api/seedance/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(seedanceBody()) });
    state.checkErrors = out.issues.filter((i) => i.level === "error");
    // References the loader had to leave out (a cut-out that cannot be made, a video that needs the public address).
    showIssues([...out.issues, ...(out.problems ?? []).map((m): Issue => ({ level: "warning", code: "reference", message: m }))]);
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
      body: JSON.stringify(sd ? { engine: "seedance", tier: state.tier, resolution: state.draft ? "480p" : state.resolution, seconds: state.seconds, versions: state.versions } : state.premium ? { engine: "blender", quality: state.premiumQuality, photos: state.refs.filter((r) => r.kind === "image").length } : { engine: "claude", versions: state.versions, photos: state.refs.filter((r) => r.kind === "image").length, voice: state.voice }),
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
  $("pPurpose").onclick = () => {
    state.purpose = state.purpose === "ad" ? "post" : "ad";
    msg(state.purpose === "post" ? "Post: a page post for your followers, with no price or contact push; it ends on the shop sign." : "Ad: the price and how to order are part of the video.", "ok");
    renderPills();
  };
  pop("pPlatform", (box) => {
    box.append(el("h6", { textContent: "Made for" }), chips(PLATFORMS.map((x) => x.id), state.platform ?? "", (v) => (state.platform = v || null), (v) => PLATFORMS.find((x) => x.id === v)?.name ?? v));
    box.append(el("p", { className: "hint", textContent: "Claude keeps text clear of the app's buttons and picks the length that works there." }));
  });
  pop("pRatio", (box) => {
    box.append(el("h6", { textContent: "Aspect ratio" }), chips(state.engine === "seedance" ? o.seedance.ratios : o.ratios, state.ratio, (v) => (state.ratio = v)));
  });
  pop("pSeconds", (box) => {
    box.append(el("h6", { textContent: "Duration" }), chips((state.engine === "seedance" ? SEEDANCE_SECONDS : state.premium ? PREMIUM_SECONDS : CLAUDE_SECONDS).map(String), String(state.seconds), (v) => (state.seconds = Number(v)), (v) => `${v} s`));
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
      box.append(el("h6", { textContent: "MP4 quality" }), chips(o.qualities, state.premium ? "" : state.quality, (v) => {
        state.quality = v as Quality;
        state.premium = false;
      }));
      // Premium 3D: a real 3D scene rendered by Blender on the studio computer (minutes, not seconds).
      const premium = el("button", { className: `btn sm${state.premium ? " on" : ""}`, textContent: "Premium 3D (Blender)", disabled: !state.blender.available });
      premium.onclick = (e) => {
        e.stopPropagation();
        state.premium = true;
        if (!PREMIUM_SECONDS.includes(state.seconds)) state.seconds = 6;
        document.querySelectorAll(".pop.open").forEach((x) => x.classList.remove("open"));
        renderPills();
      };
      const sound = state.blender.sound
        ? [
            toggleRow(`Voice-over (${state.blender.voiceCredits} credits)`, () => state.premiumVoice && state.blender.voiceReady, (v) => (state.premiumVoice = v), !state.blender.voiceReady),
            toggleRow("Music from the library", () => state.premiumMusic, (v) => (state.premiumMusic = v)),
          ]
        : [el("p", { className: "hint", textContent: "Sound (voice-over and music) comes with the next Blender update; clips are silent for now." })];
      const c = state.blender.credits;
      const resolution = chips(["540p", "720p"], state.premiumQuality, (v) => (state.premiumQuality = v as "540p" | "720p"), (v) => `${v} · ${c[v as "540p" | "720p"]} credits`);
      box.append(
        el("h6", { textContent: "Premium 3D" }),
        premium,
        ...(state.premium ? [resolution, lookLine(), ...sound] : []),
        el("p", { className: "hint", textContent: state.blender.available ? `A real 3D scene rendered in Blender on the studio computer: about 3 to 6 minutes (720p takes about twice as long), 4 to 8 seconds long. ${c["540p"]} credits at 540p, ${c["720p"]} at 720p.` : "Not available: Blender is not installed on the studio computer." }),
      );
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
      box.append(toggle("Generate sound", () => state.audio, (v) => (state.audio = v)), toggle("Fixed lens (no camera move)", () => state.fixedLens, (v) => (state.fixedLens = v)), toggle("Offline (not on Seedance 2.0 yet)", () => state.flex, (v) => (state.flex = v)), toggle("Draft (cheap 480p clip)", () => state.draft, (v) => { state.draft = v; void quote(); }));
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

/** "Look: Dark showroom": the look a Premium 3D clip gets for the chosen template and product (lookForTemplate). */
function lookLine(): HTMLElement {
  const line = el("p", { className: "hint lookLine", textContent: "…" });
  const product = state.products.find((x) => x.id === state.productId)?.name ?? "";
  void api<{ look: string; name: string }>(`/api/blender/look?${new URLSearchParams({ template: state.templateId, product })}`)
    .then((l) => (line.textContent = `${translate("look.label", "Look:")} ${translate(`look.${l.look}`, l.name)}`))
    .catch(() => line.remove());
  return line;
}

/** A labelled checkbox for a popover. */
function toggleRow(label: string, get: () => boolean, set: (v: boolean) => void, disabled = false): HTMLElement {
  const input = el("input", { type: "checkbox", checked: get(), disabled });
  input.onchange = () => set(input.checked);
  input.onclick = (e) => e.stopPropagation();
  return el("label", { className: "toggle" }, label, input);
}

/** Switches the engine (the prompt and the references stay). */
function setEngine(engine: Engine) {
  state.engine = engine;
  document.querySelectorAll<HTMLButtonElement>("#engineSw button").forEach((x) => x.classList.toggle("on", x.dataset.engine === engine));
  state.mode = "reference";
  state.seconds = engine === "seedance" ? 5 : 15;
  void showInspire(engine === "seedance");
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
  void loadHooks();
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
            // Seedance: the product alone, lifted off its background (when the photo has a plain one).
            if (state.engine === "seedance" && ph.cutout !== false) {
              const co = el("div", { className: "pk cut" }, el("img", { src: `/api/photo/${ph.assetId}?cutout=1` }), el("span", { textContent: `${p.name} · cut out` }));
              (co.firstElementChild as HTMLImageElement).onerror = () => co.remove();
              co.onclick = () => {
                if (!state.productId) state.productId = p.id;
                addRef({ id: `co:${ph.assetId}`, kind: "image", thumb: `/api/photo/${ph.assetId}?cutout=1`, label: `${p.name} cut out on a transparent background` });
                dlg.close();
              };
              grid.append(co);
            }
          }
        }
      }
    };
    sel.onchange = () => void show();
    await show();
    // Seedance: a presenter's portrait as a reference (fictional AI presenters; Seedance refuses real faces).
    if (kind === "refs" && state.engine === "seedance") {
      const inf = await api<{ influencers: Influencer[] }>("/api/influencers").catch(() => ({ influencers: [] as Influencer[] }));
      for (const i of inf.influencers.filter((x) => x.portrait)) {
        const pk = el("div", { className: "pk" }, el("img", { src: `/api/influencers/${i.id}/portrait` }), el("span", { textContent: `${i.name} · presenter portrait` }));
        pk.onclick = () => {
          addRef({ id: `pp:${i.id}`, kind: "image", thumb: `/api/influencers/${i.id}/portrait`, label: `${i.name}, the presenter (portrait)` });
          dlg.close();
        };
        grid.append(pk);
      }
    }
  } else {
    const inf = await api<{ influencers: Influencer[]; actions: { id: string; text: string }[] }>("/api/influencers");
    grid.replaceChildren();
    // Seedance: the ModelArk digital characters first (presenters it accepts). Preview ones arrive with the key.
    if (state.engine === "seedance") {
      const chars = await api<{ characters: Character[]; notice: string }>("/api/seedance/characters").catch(() => null);
      if (chars) {
        top.append(el("p", { className: "hint", textContent: chars.notice }));
        for (const c of chars.characters) {
          const preview = c.source === "preview";
          const pk = el("div", { className: `pk${preview ? " off" : ""}${state.avatar?.id === c.id ? " on" : ""}`, title: c.description }, c.portraitUrl ? el("img", { src: c.portraitUrl }) : el("div", { className: "plus", textContent: c.name[0] }), el("span", { textContent: preview ? `${c.name} · arrives with the key` : `${c.name} · digital character` }));
          if (!preview)
            pk.onclick = () => {
              state.avatar = { kind: "influencer", id: c.id, label: c.name, thumb: c.portraitUrl };
              addRef({ id: `asset:${c.id}`, kind: "image", thumb: c.portraitUrl, label: `${c.name} (digital character, presenter)` });
              renderRefs();
              dlg.close();
            };
          grid.append(pk);
        }
      }
    }
    const note = el("p", { className: "hint", textContent: state.engine === "seedance" ? "Seedance refuses real faces. Choose a digital character above, or a fictional AI presenter below: a photo (Gemini) of them holding your product becomes an Image reference." : "Cartoon presenters are free and drawn by the engine. Realistic AI presenters are photos (15 credits each)." });
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
      const out = await api<{ jobs: SdJob[]; problems?: string[] }>("/api/seedance/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(seedanceBody()) });
      const preview = out.jobs[0]?.status.startsWith("preview");
      const leftOut = out.problems?.length ? ` Left out: ${out.problems.join(" ")}` : "";
      msg(`${preview ? "Preview: Seedance arrives with the BytePlus key. This is the shot plan it will film, with the price; no credits were taken." : `Seedance is making ${out.jobs.length > 1 ? `${out.jobs.length} videos` : "your video"}. Usually 1 to 5 minutes; you can keep working.`}${leftOut}`, "ok");
      await loadGens();
      openDrawer(state.gens.find((g) => g.id === out.jobs[0].id) ?? null);
    } else {
      if (!state.productId) throw new Error("Pick a product (the PRODUCT tile).");
      if (state.premium) {
        msg("Premium 3D: Claude designs the 3D scene, then Blender renders it here. About 3 to 6 minutes; you can keep working.");
        const out = await api<{ job: PremiumJob }>("/api/blender/render", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId: state.businessId, productId: state.productId, photoIds: state.refs.filter((r) => r.kind === "image").map((r) => r.id.split(":")[1]), styleId: state.templateId, hookId: state.hookId, ratio: state.ratio, seconds: state.seconds, note: prompt, platform: state.platform, voice: state.premiumVoice, music: state.premiumMusic, quality: state.premiumQuality }),
        });
        await loadGens();
        openDrawer(state.gens.find((g) => g.id === out.job.id) ?? null);
        await refreshWallet();
        return;
      }
      msg(`Claude is designing ${state.versions > 1 ? `${state.versions} versions` : "the video"}… (about 1 to 2 minutes)`);
      const out = await api<{ jobs: ClaudeJob[]; error: string | null }>("/api/design", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: state.mode, businessId: state.businessId, productId: state.productId, photoIds: state.refs.filter((r) => r.kind === "image").map((r) => r.id.split(":")[1]), styleId: state.templateId, hookId: state.hookId, ratio: state.ratio, seconds: state.seconds, note: prompt, fixedLens: state.fixedLens, cartoonId: state.avatar?.kind === "cartoon" ? state.avatar.id : null, versions: state.versions, platform: state.platform, purpose: state.purpose, chosenHook: state.chosenHook ? { hookId: state.chosenHook.hookId, line: state.chosenHook.line } : null }),
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
  const [cl0, sd, pm] = await Promise.all([api<{ jobs: ClaudeJob[] }>("/api/jobs"), api<{ jobs: SdJob[] }>("/api/seedance/jobs"), api<{ jobs: PremiumJob[] }>("/api/blender/jobs").catch(() => ({ jobs: [] as PremiumJob[] }))]);
  const cl = { jobs: await withSpecs(cl0.jobs) };
  const gens: Gen[] = [
    ...pm.jobs.map((j): Gen => ({ engine: "claude", id: j.id, title: j.title, status: j.status, at: j.createdAt, videoUrl: j.videoFile ? `/videos/blender/${j.id}.mp4` : null, pm: j })),
    ...sd.jobs.map((j): Gen => ({ engine: "seedance", id: j.id, title: j.title, status: j.status, at: j.createdAt, videoUrl: j.videoFile ? `/videos/seedance/${j.id}.mp4` : null, sd: j })),
    ...cl.jobs.filter((j) => j.styleId !== "sample").map((j): Gen => ({ engine: "claude", id: j.id, title: j.productName, status: j.status === "failed" ? "failed" : j.video ? "succeeded" : "designed", at: j.createdAt, videoUrl: j.video ? `/videos/${j.id}.mp4` : null, claude: j })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  state.gens = gens;
  const grid = $("genGrid");
  $("gens").hidden = gens.length === 0;
  grid.replaceChildren();
  for (const g of gens.slice(0, 24)) {
    const card = el("div", { className: `genCard${g.sd?.preview ? " pv" : ""}` });
    card.dataset.id = g.id;
    if (g.videoUrl) {
      // "#t=1": the card shows a frame one second in, not the (often black) first frame.
      const v = el("video", { src: `${g.videoUrl}#t=1`, muted: true, loop: true, playsInline: true, preload: "metadata" });
      card.onmouseenter = () => void v.play().catch(() => undefined);
      card.onmouseleave = () => v.pause();
      card.append(v);
    } else if (g.engine === "claude" && g.claude?.spec) {
      const c = el("canvas");
      const size = canvasSize(g.claude.spec, "480p");
      c.width = size.width;
      c.height = size.height;
      card.append(c);
      void photosFor(g.claude.photoIds ?? []).then((ph) => drawSpecFrame(c.getContext("2d") as CanvasRenderingContext2D, g.claude?.spec as MotionSpec, ph, 1500, { quality: "480p" }));
    } else if (g.pm) {
      const j = g.pm;
      card.append(el("div", { className: "wait" }, j.status === "failed" ? el("span", { textContent: `Failed: ${j.error ?? "the 3D clip could not be made."}` }) : el("span", { className: "spin" }), el("span", { textContent: j.status === "designing" ? "Designing the 3D scene…" : j.status === "voicing" ? "Recording the voice-over…" : j.status === "rendering" ? `Rendering in Blender… ${Math.round(j.progress * 100)}%` : "" })));
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
    // A preview's storyboard frame draws its own labels: its name goes in a bar under the frame instead of over it.
    if (g.sd?.preview) card.append(el("div", { className: "cap", textContent: `Seedance preview · ${g.title}` }));
    else card.append(el("span", { className: `st ${g.status}`, textContent: g.pm ? "Premium 3D" : g.engine === "seedance" ? "Seedance" : "Motion" }), el("div", { className: "cap", textContent: g.title }));
    // Check badges, stacked top right: the research score, facts to check, and a weak caption (under 70).
    const badges: HTMLElement[] = [];
    if (g.claude?.score) badges.push(el("span", { className: "scoreTag", textContent: `Research score ${g.claude.score.score}/100` }));
    if (g.claude?.warnings?.length) badges.push(el("span", { className: "factTag", textContent: `${g.claude.warnings.length} fact${g.claude.warnings.length === 1 ? "" : "s"} to check` }));
    if (g.claude?.purpose === "post") badges.push(el("span", { className: "postTag", textContent: "Post" }));
    if (g.claude?.captionScore !== undefined && g.claude.captionScore < 70) badges.push(el("span", { className: "capTag", textContent: `Caption ${g.claude.captionScore}/100` }));
    if (badges.length) card.append(el("div", { className: "badges" }, ...badges));
    // The shape, so feed versions (1:1, 4:5) stand out from the vertical ones.
    if (g.claude?.ratio) card.append(el("span", { className: `shapeTag${g.claude.ratio !== "9:16" ? " feed" : ""}`, textContent: g.claude.mode === "reshape" ? `${g.claude.ratio} · re-shaped` : g.claude.ratio }));
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
  $("dActions").replaceChildren(motion, edit, textButton(g, j, "Try BuPulse text on a stand-in clip"));
}

/** The drawer for a Premium 3D clip: progress while Claude designs and Blender renders, then the video. */
function showPremium(g: Gen, j: PremiumJob): [string, string][] {
  $("dTitle").textContent = `Premium 3D · ${j.title}`;
  const media = $("dMedia");
  if (g.videoUrl) media.append(el("video", { src: g.videoUrl, controls: true, autoplay: true, loop: true, playsInline: true }));
  else if (j.status === "failed") media.append(el("p", { className: "err", textContent: j.error ?? "The 3D clip could not be made." }));
  else {
    media.append(el("div", { className: "wait", style: "padding:30px;text-align:center" }, el("span", { className: "spin" }), el("div", { className: "muted", textContent: j.status === "designing" ? "Claude is designing the 3D scene…" : j.status === "voicing" ? "Recording the voice-over…" : `Blender is rendering: ${Math.round(j.progress * 100)}%. About 3 to 6 minutes in all; this updates by itself.` })));
    const bar = $("dProgress");
    bar.hidden = false;
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round((j.status === "designing" ? 0.03 : j.progress) * 100)}%`;
    // Follow this job closely while the drawer shows it.
    setTimeout(async () => {
      if (state.open?.id !== j.id) return;
      const fresh = await api<PremiumJob>(`/api/blender/jobs/${j.id}`).catch(() => null);
      if (!fresh || state.open?.id !== j.id) return;
      await loadGens();
      openDrawer(state.gens.find((x) => x.id === j.id) ?? null);
      if (fresh.status !== "designing" && fresh.status !== "rendering") await refreshWallet();
    }, 4000);
  }
  $("dPrompt").textContent = j.caption ? `${j.caption}\n\n${j.hashtags.map((h) => `#${h}`).join(" ")}` : "";
  showFacts({ warnings: j.warnings, caption: j.caption ? `${j.caption}\n${j.hashtags.map((h) => `#${h}`).join(" ")}` : null });
  // What the studio changed in Claude's scene to keep it within the rules (amber, for information).
  if (j.repairs?.length) {
    const box = $("dFacts");
    box.hidden = false;
    box.append(el("h5", { textContent: "Scene repairs" }), ...j.repairs.map((r) => el("div", { className: "issue warning", textContent: r })));
  }
  // The same scene again, without a new design: a sharper 720p, or a 540p.
  if (j.status === "succeeded" && g.videoUrl) {
    const actions = $("dActions");
    // A silent clip can get its voice-over and music in the same re-render.
    const addSound = state.blender.sound && !j.audio?.voiceFile && !!j.say;
    const options: { q: "720p" | "540p"; sound: boolean }[] = [{ q: "720p", sound: false }, { q: "540p", sound: false }, ...(addSound ? [{ q: "540p" as const, sound: true }] : [])];
    for (const { q, sound } of options) {
      const b = el("button", { className: "btn sm", textContent: sound ? `Render again with voice and music (${state.blender.credits.rerender} + ${state.blender.voiceCredits} credits)` : `Render again at ${q} (${state.blender.credits.rerender} credits)` });
      b.onclick = async () => {
        b.disabled = true;
        try {
          const out = await api<{ job: PremiumJob }>(`/api/blender/jobs/${j.id}/rerender`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quality: q, voice: sound, music: sound }) });
          await loadGens();
          openDrawer(state.gens.find((x) => x.id === out.job.id) ?? null);
          await refreshWallet();
        } catch (e) {
          $("dMsg").textContent = (e as Error).message;
          b.disabled = false;
        }
      };
      actions.append(b);
    }
  }
  return [
    ["Status", j.status === "succeeded" ? "Ready" : j.status],
    ["Length", `${j.seconds} s${j.quality ? ` · ${j.quality}` : ""}`],
    ["Credits", `${j.credits}${j.parentId ? " (re-render)" : ""}`],
    ...(j.renderSeconds ? ([["Render time", `${Math.floor(j.renderSeconds / 60)} min ${j.renderSeconds % 60} s`]] as [string, string][]) : []),
    ...(j.say ? ([["Voice line", j.say]] as [string, string][]) : []),
    ...(j.audio?.voiceFile ? ([["Voice-over", "yes"]] as [string, string][]) : []),
    ...(j.audio?.voiceNote ? ([["Voice note", j.audio.voiceNote]] as [string, string][]) : []),
    ...(j.audio?.musicTitle ? ([["Music", j.audio.musicTitle]] as [string, string][]) : []),
  ];
}

/**
 * "Check these facts": claims the fact check could not find in the product's facts (red) or found only in the
 * business's general description (amber), and the research rules the design missed.
 */
function showFacts(j: { warnings?: FactWarning[]; score?: DesignScore; captionScore?: number; captionMissed?: string[]; caption?: string | null }) {
  const box = $("dFacts");
  const warnings = j.warnings ?? [];
  const failed = j.score?.failed ?? [];
  const hasCaption = j.captionScore !== undefined;
  box.hidden = !warnings.length && !failed.length && !hasCaption;
  box.replaceChildren(
    // The post caption, with the Brain's caption check under it.
    ...(hasCaption
      ? [
          el("h5", { textContent: `Caption check ${j.captionScore}/100` }),
          ...(j.caption ? [el("p", { className: "capText", textContent: j.caption })] : []),
          ...(j.captionMissed ?? []).map((m) => el("div", { className: `issue ${(j.captionScore ?? 100) < 70 ? "error" : "warning"}`, textContent: m })),
        ]
      : []),
    ...(warnings.length ? [el("h5", { textContent: "Check these facts" }), ...warnings.map((w) => el("div", { className: `issue ${w.problem === "not-in-brief" ? "error" : "warning"}`, textContent: `${w.where}: ${w.message}` }))] : []),
    ...(failed.length ? [el("h5", { textContent: `Research score ${j.score?.score}/100: what it missed` }), ...failed.map((f) => el("div", { className: "issue warning", textContent: `${f.scene ? `Scene ${f.scene}: ` : ""}${f.reason}` }))] : []),
  );
}

// ---- "Add BuPulse text" on a Seedance clip (video-lab/seedance-overlays.ts) -----------------------------------------------

type Overlay = { jobId: string; spec: MotionSpec; clipUrl: string; standIn: boolean; captionScore: number; captionMissed: string[]; video: { bytes: number } | null };
/** The clip's frames for the live preview; closed when the drawer changes or closes. */
let overlayFrames: { close(): void } | null = null;
function closeOverlayFrames() {
  overlayFrames?.close();
  overlayFrames = null;
}

/** The button that adds (or opens) BuPulse's text over a clip: the hook, price, phone bar and call to action. */
function textButton(g: Gen, j: SdJob, label: string): HTMLElement {
  const b = el("button", { className: "btn sm", textContent: label });
  b.onclick = async () => {
    b.disabled = true;
    try {
      const existing = await api<Overlay>(`/api/seedance/jobs/${j.id}/overlay`).catch(() => null);
      const o = existing ?? (await api<Overlay>(`/api/seedance/jobs/${j.id}/overlay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: state.platform }) }));
      void showOverlay(g, o);
    } catch (e) {
      $("dMsg").textContent = (e as Error).message;
      b.disabled = false;
    }
  };
  return b;
}

/** The clip with BuPulse's text: the live preview (the clip's frames under the text), then the MP4. */
async function showOverlay(g: Gen, o: Overlay) {
  closeOverlayFrames();
  cancelAnimationFrame(drawerAnim);
  const spec = o.spec;
  const media = $("dMedia");
  const actions = $("dActions");
  $("dTitle").textContent = `Seedance · ${g.title} · with BuPulse text`;
  media.replaceChildren(...(o.standIn ? [el("div", { className: "pvNotice", textContent: "Stand-in clip: a finished studio video plays where the Seedance clip will be. The real clip arrives with the BytePlus key." })] : []));
  const dl = $<HTMLAnchorElement>("dDl");
  const textUrl = `/videos/seedance/${o.jobId}-text.mp4`;
  dl.hidden = !o.video;
  if (o.video) {
    dl.href = textUrl;
    dl.download = `bupulse-${o.jobId}-text.mp4`;
    media.append(el("video", { src: `${textUrl}?v=${o.video.bytes}`, controls: true, autoplay: true, loop: true, playsInline: true }));
  } else {
    const c = el("canvas");
    const size = canvasSize(spec, "720p");
    c.width = size.width;
    c.height = size.height;
    media.append(c);
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    const photos: Photos = new Map();
    await loadSpecFonts(spec);
    const frames = await openVideoFrames(spec);
    overlayFrames = frames;
    if (frames.failed.length) $("dMsg").textContent = `The clip could not be opened here (${frames.failed.join(", ")}).`;
    const total = totalMs(spec);
    let t = 0;
    let last = performance.now();
    // The clip's frames are prepared before each draw, in time order.
    const loop = async (now: number) => {
      if (state.open !== g || !c.isConnected || overlayFrames !== frames) return;
      t = (t + now - last) % total;
      last = now;
      // A frame that does not decode in time (a busy computer) is skipped: the last one stays on screen.
      const ready = await frames.prepare(t, photos).then(() => true, () => false);
      // Counted on the canvas, so a check can see whether frames arrive late.
      if (!ready) c.dataset.skipped = String(Number(c.dataset.skipped ?? 0) + 1);
      if (ready) drawSpecFrame(ctx, spec, photos, t, { quality: "720p" });
      drawerAnim = requestAnimationFrame((n) => void loop(n));
    };
    drawerAnim = requestAnimationFrame((n) => void loop(n));
  }
  const make = el("button", { className: "btn sm primary", textContent: `${o.video ? "Make the MP4 again" : "Make MP4 with text"} (${state.quality}, free)` });
  make.onclick = async () => {
    make.disabled = true;
    const bar = $("dProgress");
    bar.hidden = false;
    const fill = bar.firstElementChild as HTMLElement;
    // The live preview stops while the MP4 is made: one decoder per clip, and the computer's time for the encoder.
    cancelAnimationFrame(drawerAnim);
    closeOverlayFrames();
    $("dMsg").textContent = "Making the MP4 with the clip and the text in this browser…";
    try {
      const blob = await encodeSpecMp4(spec, new Map(), { quality: state.quality, onProgress: (f) => (fill.style.width = `${Math.round(f * 100)}%`) });
      const saved = await api<Overlay & { tracks: string[] }>(`/api/seedance/jobs/${o.jobId}/overlay/video?q=${state.quality}`, { method: "POST", headers: { "content-type": "video/mp4" }, body: blob });
      await showOverlay(g, saved);
      $("dMsg").textContent = `MP4 with text ready (${(blob.size / 1024 / 1024).toFixed(1)} MB; ${saved.tracks.includes("soun") ? "with the clip's sound" : "no sound track"}).`;
    } catch (e) {
      $("dMsg").textContent = (e as Error).message;
      make.disabled = false;
    } finally {
      bar.hidden = true;
      fill.style.width = "0";
    }
  };
  const back = el("button", { className: "btn sm", textContent: "Back to the clip" });
  back.onclick = () => openDrawer(g);
  actions.replaceChildren(make, back);
  $("dInfo").replaceChildren(...([["Overlay", "hook, price, phone bar, call to action"], ["Credits", "0 (made in this browser)"], ["Clip", o.standIn ? "stand-in (preview mode)" : "the Seedance clip"]] as [string, string][]).flatMap(([k, v]) => [el("span", { className: "k", textContent: k }), el("span", { textContent: v })]));
  showFacts({ captionScore: o.captionScore, captionMissed: o.captionMissed, caption: `${spec.caption}\n${spec.hashtags.map((h) => `#${h}`).join(" ")}` });
}

/**
 * "First comment (pin it)": what the seller posts as the first comment under the video (price, place, delivery,
 * WhatsApp; the Brain's firstCommentFor), with a copy button. Added under the caption when the job has a product.
 */
async function showFirstComment(g: Gen, businessId: string | null | undefined, productId: string | null | undefined) {
  if (!businessId || !productId) return;
  const q = new URLSearchParams({ business: businessId, product: productId });
  const out = await api<{ comment: { text: string; lines: string[] } | null }>(`/api/first-comment?${q}`).catch(() => null);
  if (!out?.comment || state.open?.id !== g.id) return;
  const text = out.comment.text;
  const copy = el("button", { className: "btn sm", textContent: "Copy" });
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select the text to copy";
    }
  };
  const box = $("dFacts");
  box.hidden = false;
  box.append(el("div", { className: "firstComment" }, el("h5", { textContent: "First comment (pin it)" }), el("p", { className: "capText", textContent: text }), copy));
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
  $("dFacts").hidden = true;
  const info: [string, string][] = [];
  cancelAnimationFrame(drawerAnim);
  closeOverlayFrames();
  if (g.engine === "seedance" && g.sd?.preview) {
    $("dPrompt").textContent = g.sd.request.prompt;
    void showPreview(g, g.sd);
    void showFirstComment(g, g.sd.businessId, g.sd.productId);
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
    if (g.videoUrl) actions.append(textButton(g, j, "Add BuPulse text (free)"));
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
    void showFirstComment(g, j.businessId, j.productId);
  } else if (g.pm) {
    info.push(...showPremium(g, g.pm));
  } else if (g.claude && !g.claude.spec && g.claude.status !== "failed") {
    // The jobs list leaves the design out (finished videos especially): fetch it, then show the drawer.
    media.append(el("span", { className: "spin" }));
    void api<ClaudeJob>(`/api/jobs/${g.id}`).then((full) => {
      fullClaude.set(g.id, full);
      if (state.open === g) openDrawer({ ...g, claude: full });
    });
  } else if (g.claude) {
    const j = g.claude;
    if (j.spec) {
      const spec = j.spec;
      const c = el("canvas");
      const size = canvasSize(spec, "720p");
      c.width = size.width;
      c.height = size.height;
      // A finished MP4 (with its music and voice-over) plays; the live preview is drawn while there is none.
      if (g.videoUrl) media.append(el("video", { src: g.videoUrl, controls: true, autoplay: true, loop: true, playsInline: true }));
      else media.append(c);
      const ctx = c.getContext("2d") as CanvasRenderingContext2D;
      void Promise.all([loadPhotos(j.photoIds.map((id) => `/api/photo/${id}`), j.photoIds.map(cutoutUrl)), loadSpecFonts(spec)]).then(([ph]) => {
        state.photos = ph;
        let last = performance.now();
        let t = 0;
        const total = totalMs(spec);
        const loop = (now: number) => {
          if (state.open !== g || !c.isConnected) return;
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
      // The same design for the feeds, free: the validator re-lays it for the new shape (no Claude call).
      const others = (["1:1", "4:5"] as const).filter((r) => r !== spec.ratio);
      if (others.length) {
        const row = el("div", { className: "row reshapes" }, el("span", { className: "muted small", textContent: "Other shapes (free):" }));
        for (const r of others) {
          const b = el("button", { className: "btn sm", textContent: r === "1:1" ? "1:1 · Facebook feed" : "4:5 · Instagram feed" });
          b.onclick = async () => {
            b.disabled = true;
            try {
              const child = await api<ClaudeJob>(`/api/jobs/${j.id}/reshape`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ratio: r }) });
              fullClaude.set(child.id, child);
              await loadGens();
              openDrawer(state.gens.find((x) => x.id === child.id) ?? null);
              $("dMsg").textContent = `The ${r} version is ready: no credits used. Press Make MP4 to render it${voices.has(j.id) || state.voice ? " (the voice-over take is reused for free)" : ""}.`;
            } catch (e) {
              $("dMsg").textContent = (e as Error).message;
              b.disabled = false;
            }
          };
          row.append(b);
        }
        actions.append(row);
      }
      $("dEdit").hidden = false;
      $("dEditBtn").onclick = () => void editClaude(g, "edit");
      $("dExtendBtn").onclick = () => void editClaude(g, "extend");
      info.push(["Length", `${(totalMs(spec) / 1000).toFixed(1)} s · ${spec.scenes.length} scenes`], ["Camera", [...new Set(spec.scenes.map((s) => s.camera?.move ?? "static"))].join(", ")], ["Look", spec.look?.grade ?? "none"], ["API-equivalent cost", `$${(j.apiEquivalentUsd ?? 0).toFixed(3)}`]);
      if (j.score) info.push(["Research score", `${j.score.score}/100`]);
      if (j.captionScore !== undefined) info.push(["Caption check", `${j.captionScore}/100`]);
      showFacts({ ...j, caption: [spec.caption, spec.hashtags.map((h) => `#${h}`).join(" ")].filter(Boolean).join("\n") });
      void showFirstComment(g, j.businessId, j.productId);
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
    await loadGens();
    openDrawer(state.gens.find((x) => x.id === g.id) ?? null);
    // After the drawer is redrawn (it clears its message), so the owner sees the result.
    $("dMsg").textContent = `MP4 ready (${(blob.size / 1024 / 1024).toFixed(1)} MB). ${notes.join(" ")}`;
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

/**
 * The product lifted off its background, for turntables and floating products. Asked for only when it exists or was
 * never tried (GET /api/cutouts, loaded at start), so photos known to have none cause no 404.
 */
let cutoutsRefused = new Set<string>();
const cutoutUrl = (id: string): string | null => (cutoutsRefused.has(id) ? null : `/api/photo/${id}?cutout=1`);

// ---- Templates and carousel ------------------------------------------------------------------------------------------

const previewPhotos = new Map<string, Promise<Photos>>();
const photosFor = (ids: string[]) => {
  const key = ids.join(",");
  if (!previewPhotos.has(key)) previewPhotos.set(key, loadPhotos(ids.map((id) => `/api/photo/${id}?size=thumb`), ids.map(cutoutUrl)));
  return previewPhotos.get(key) as Promise<Photos>;
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

// ---- Start -----------------------------------------------------------------------------------------------------------

async function start() {
  const [o, cut] = await Promise.all([api<Options>("/api/options"), api<{ refused: string[] }>("/api/cutouts").catch(() => ({ refused: [] as string[] }))]);
  state.o = o;
  cutoutsRefused = new Set(cut.refused);
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
  // "Use this" on an example: its shape and length (Seedance), and its product (below, once products are loaded).
  if (q.get("engine") === "seedance") {
    state.engine = "seedance";
    document.querySelectorAll<HTMLButtonElement>("#engineSw button").forEach((b) => b.classList.toggle("on", b.dataset.engine === "seedance"));
  }
  const ratio = q.get("ratio");
  if (ratio && (state.engine === "seedance" ? o.seedance.ratios : o.ratios).includes(ratio)) state.ratio = ratio;
  const seconds = Number(q.get("seconds"));
  if (state.engine === "seedance" && seconds >= o.seedance.limits.minSeconds && seconds <= o.seedance.limits.maxSeconds) state.seconds = Math.round(seconds);
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
    const wanted = q.get("business");
    state.businessId = state.businesses.find((b) => b.id === wanted)?.id ?? state.businesses[0]?.id ?? "";
    state.products = state.businessId ? await api<Product[]>(`/api/products?business=${encodeURIComponent(state.businessId)}`) : [];
    // ?product= (an example's "Use this"): that product, with as many of its photos as the prompt uses (at least 1).
    const product = state.products.find((x) => x.id === q.get("product"));
    if (product) {
      state.productId = product.id;
      const count = Math.min(9, Math.max(1, Number(q.get("photos")) || 1));
      for (const ph of product.photos.slice(0, count)) state.refs.push({ id: `ph:${ph.assetId}`, kind: "image", thumb: `/api/photo/${ph.assetId}?size=thumb`, label: `${product.name} photo${ph.description ? `: ${ph.description}` : ""}` });
    }
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
      state.blender.credits = p.premium3dCredits ?? state.blender.credits;
      state.voiceCredits = p.voiceCredits ?? state.voiceCredits;
    })
    .catch(() => undefined);
  $<HTMLInputElement>("tsearch").oninput = renderTemplates;
  window.addEventListener("studio:lang", renderTemplates);
  setupInspire();
  void api<typeof state.blender>("/api/blender/status")
    .then((b) => (state.blender = b))
    .catch(() => undefined);
  void showInspire(state.engine === "seedance");
  $("go").onclick = () => void generate();
  $("pickClose").onclick = () => ($("pickDlg") as HTMLDialogElement).close();
  $("planClose").onclick = () => ($("planDlg") as HTMLDialogElement).close();
  $("dClose").onclick = () => {
    $("drawer").classList.remove("open");
    state.open = null;
    closeOverlayFrames();
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
  carousel($("carousel"), show.items.filter((i) => i.videoUrl).map((i) => ({ id: i.id, videoUrl: i.videoUrl as string, engine: i.engine })));
  setInterval(async () => {
    if (state.gens.some((g) => (g.engine === "seedance" && (g.status === "queued" || g.status === "running" || g.status === "submitting" || g.status === "preview")) || (g.pm && (g.status === "designing" || g.status === "voicing" || g.status === "rendering")))) {
      await loadGens();
      if (state.open?.engine === "seedance") openDrawer(state.gens.find((g) => g.id === state.open?.id) ?? null);
      await refreshWallet();
    }
  }, 10_000);
}
void start().catch((e) => msg((e as Error).message, "err"));
