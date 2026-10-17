// Seedance preview (docs/VIDEO_ENGINE.md, "Preview mode"): while the BytePlus key is missing, a Seedance request
// becomes a storyboard instead of a clip. The shot list is read from the prompt itself (time codes, shot types,
// camera moves, sound, spoken lines, the references each shot names), so it shows what Seedance will be asked to film,
// whoever wrote the prompt. 3 or 4 sketched frames (SVG, with the reference photo when the shot uses one) and the
// price of the real clip come with it. Pure: no network, no files.
import { SEEDANCE_MODELS, estimateSeedanceUsd, type SeedanceRequest } from "@/lib/video-engine/seedance";
import { checkSeedanceRequest, detectCamera, detectShotType, type SeedanceIssue } from "@/lib/video-engine/seedance-brain";

export const PREVIEW_NOTICE = "Preview: Seedance arrives with the BytePlus key. This is the shot plan Seedance will film; no credits were taken.";

export type StoryShot = {
  n: number;
  from: number;
  to: number;
  shot: string;
  camera: string;
  cameraId: string;
  action: string;
  sound: string | null;
  spoken: string | null;
  references: string[];
};
/** `label` is "2" for a whole shot, "2a" / "2b" for parts of a long shot that gets two frames; from/to are its times. */
export type StoryFrame = { at: number; shot: number; label: string; from: number; to: number; caption: string; svg: string };
export type StoryReference = { label: string; kind: "image" | "video" | "audio"; thumb: string | null };
export type Storyboard = {
  kind: "seedance-storyboard";
  notice: string;
  title: string;
  model: string;
  tier: SeedanceRequest["tier"];
  resolution: string;
  ratio: string;
  seconds: number;
  audio: boolean;
  fixedLens: boolean;
  /** The opening line of the prompt (setting, light, music) when it has one before the first time code. */
  setting: string | null;
  prompt: string;
  shots: StoryShot[];
  frames: StoryFrame[];
  references: StoryReference[];
  estimate: { usd: number; credits: number; wait: string };
  issues: SeedanceIssue[];
};

const TIMECODE = /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\b\s*[:.)–-]?/gi;
const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s;:,.–-]+|[\s;,–-]+$/g, "").trim();

function describe(text: string, n: number, from: number, to: number, fixedLens: boolean): StoryShot {
  const spokenMatch = text.match(/"([^"]{2,})"|“([^”]{2,})”/);
  const soundMatch = text.match(/Sound:\s*([^."“]+)/i);
  const action = clean(
    text
      .replace(/[^.]*?(says?|voice-?over)[^.]*?("[^"]*"|“[^”]*”)/gi, "")
      .replace(/"[^"]*"|“[^”]*”/g, "")
      .replace(/Sound:\s*[^."“]+\.?/gi, ""),
  ).slice(0, 240);
  const shot = detectShotType(text);
  const camera = fixedLens ? null : detectCamera(text);
  return {
    n,
    from,
    to,
    shot: shot?.name ?? "Medium shot",
    camera: fixedLens ? "Static camera (fixed lens)" : (camera?.words ?? "Gentle natural movement"),
    cameraId: fixedLens ? "static" : (camera?.id ?? "static"),
    action: action || "The scene continues.",
    sound: soundMatch ? clean(soundMatch[1]) : null,
    spoken: spokenMatch ? (spokenMatch[1] ?? spokenMatch[2]).trim() : null,
    references: [...new Set([...text.matchAll(/\b(Image|Video|Audio)\s*(\d+)/gi)].map((m) => `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`))],
  };
}

/** The shots of a prompt: by its time codes ("0-2s: ..."), or its sentences spread over the length when it has none. */
export function parseShots(prompt: string, seconds: number, fixedLens = false): { setting: string | null; shots: StoryShot[] } {
  const marks = [...prompt.matchAll(TIMECODE)];
  if (marks.length) {
    const setting = clean(prompt.slice(0, marks[0].index)) || null;
    const shots = marks.map((m, i) => {
      const start = (m.index ?? 0) + m[0].length;
      const end = i + 1 < marks.length ? marks[i + 1].index : prompt.length;
      const from = Math.min(seconds, Math.max(0, Number(m[1])));
      const to = Math.min(seconds, Math.max(from, Number(m[2])));
      return describe(prompt.slice(start, end), i + 1, from, to, fixedLens);
    });
    return { setting, shots };
  }
  const sentences = prompt.split(/(?<=[.!?])\s+/).map(clean).filter(Boolean);
  const k = Math.max(1, Math.min(4, sentences.length, Math.round(seconds / 3)));
  const per = Math.ceil(sentences.length / k);
  const shots = Array.from({ length: k }, (_, i) => {
    const from = Math.round(((seconds * i) / k) * 10) / 10;
    const to = Math.round(((seconds * (i + 1)) / k) * 10) / 10;
    return describe(sentences.slice(i * per, (i + 1) * per).join(" "), i + 1, from, to, fixedLens);
  });
  return { setting: null, shots };
}

type Moment = { at: number; shot: StoryShot; label: string; from: number; to: number };
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The frames follow the shots: one per shot up to 4 (with 5, the first, two middle ones and the last). With fewer
 * than 3 shots, the longest shots are split so there are 3 frames, each part with its own label (2a, 2b) and times.
 */
function keyMoments(shots: StoryShot[]): Moment[] {
  const picked = shots.length > 4 ? [...new Set([0, Math.round((shots.length - 1) / 3), Math.round(((shots.length - 1) * 2) / 3), shots.length - 1])].map((i) => shots[i]) : shots;
  const parts = picked.map(() => 1);
  while (parts.reduce((a, k) => a + k, 0) < 3) {
    let best = 0;
    picked.forEach((s, i) => {
      if ((s.to - s.from) / parts[i] > (picked[best].to - picked[best].from) / parts[best]) best = i;
    });
    parts[best] += 1;
  }
  return picked.flatMap((shot, i) => {
    const k = parts[i];
    const step = (shot.to - shot.from) / k;
    return Array.from({ length: k }, (_, j) => {
      const from = round1(shot.from + step * j);
      const to = round1(shot.from + step * (j + 1));
      return { at: round1((from + to) / 2), shot, label: k > 1 ? `${shot.n}${String.fromCharCode(97 + j)}` : String(shot.n), from, to };
    });
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function frameSize(ratio: string): { w: number; h: number } {
  const [a, b] = ratio === "adaptive" || !/^\d+:\d+$/.test(ratio) ? [9, 16] : ratio.split(":").map(Number);
  return a < b ? { w: Math.round((320 * a) / b), h: 320 } : { w: 320, h: Math.round((320 * b) / a) };
}

/** Line art for the camera move, drawn around the frame's centre. */
function cameraGlyph(id: string, cx: number, cy: number, r: number, m: string): string {
  const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" marker-end="url(#${m})"/>`;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  switch (id) {
    case "push-in":
      return corners.map(([x, y]) => line(cx + x * r * 1.4, cy + y * r * 1.4, cx + x * r * 0.7, cy + y * r * 0.7)).join("");
    case "pull-out":
      return corners.map(([x, y]) => line(cx + x * r * 0.6, cy + y * r * 0.6, cx + x * r * 1.3, cy + y * r * 1.3)).join("");
    case "dolly-zoom":
      return corners.map(([x, y]) => line(cx + x * r * 0.5, cy + y * r * 0.5, cx + x * r * 1.0, cy + y * r * 1.0)).join("") + `<rect x="${cx - r * 1.3}" y="${cy - r * 1.3}" width="${r * 2.6}" height="${r * 2.6}" stroke-dasharray="4 3"/>`;
    case "pan":
      return line(cx - r * 1.4, cy, cx + r * 1.4, cy);
    case "whip-pan":
      return [-0.4, 0, 0.4].map((d) => line(cx - r * 1.4, cy + d * r, cx + r * 1.4, cy + d * r)).join("");
    case "tilt-up":
      return line(cx, cy + r * 1.4, cx, cy - r * 1.4);
    case "crane-up":
      return `<path d="M${cx - r * 1.4},${cy + r} Q${cx},${cy - r * 1.8} ${cx + r * 1.4},${cy - r * 0.6}" marker-end="url(#${m})"/>`;
    case "drone":
      return `<path d="M${cx - r * 1.4},${cy + r * 0.6} Q${cx},${cy - r * 1.2} ${cx + r * 1.4},${cy + r * 0.6}" marker-end="url(#${m})"/><path d="M${cx - 6},${cy - r * 1.3} h12 M${cx},${cy - r * 1.3 - 6} v12"/>`;
    case "orbit":
      return `<path d="M${cx + r * 1.4},${cy} A${r * 1.4},${r * 0.55} 0 1 1 ${cx + r * 0.9},${cy - r * 0.45}" marker-end="url(#${m})"/>`;
    case "tracking":
    case "gimbal":
      return `<path d="M${cx - r * 1.2},${cy + r * 1.2} C${cx - r * 0.4},${cy + r * 0.2} ${cx + r * 0.2},${cy + r * 0.4} ${cx + r * 1.2},${cy - r * 0.9}" marker-end="url(#${m})"/>`;
    case "handheld":
      return `<path d="M${cx - r * 1.4},${cy} q${r * 0.35},-${r * 0.4} ${r * 0.7},0 t${r * 0.7},0 t${r * 0.7},0 t${r * 0.7},0"/>`;
    case "rack-focus":
      return `<circle cx="${cx - r * 0.8}" cy="${cy}" r="${r * 0.45}" stroke-dasharray="3 3"/><circle cx="${cx + r * 0.8}" cy="${cy}" r="${r * 0.45}"/>${line(cx - r * 0.25, cy, cx + r * 0.25, cy)}`;
    case "slow-motion":
      return `<circle cx="${cx}" cy="${cy}" r="${r}"/><path d="M${cx},${cy} v-${r * 0.7} M${cx},${cy} h${r * 0.5}"/>`;
    default:
      return `<rect x="${cx - r * 0.7}" y="${cy - r * 0.9}" width="${r * 1.4}" height="${r * 0.9}" rx="3"/><path d="M${cx},${cy} l-${r * 0.7},${r * 1.2} M${cx},${cy} v${r * 1.2} M${cx},${cy} l${r * 0.7},${r * 1.2}"/>`;
  }
}

/** A simple sketch of what the shot shows, for shots without a reference photo. */
function subjectSketch(shot: StoryShot, w: number, h: number): string {
  const cx = w / 2;
  const t = `${shot.shot} ${shot.action}`;
  if (/presenter|woman|\bman\b|customer|client|student|model|stylist|dancers?|server|worker|teacher|person/i.test(t)) {
    return `<circle cx="${cx}" cy="${h * 0.36}" r="${Math.min(w, h) * 0.1}"/><path d="M${cx - w * 0.22},${h * 0.78} Q${cx - w * 0.2},${h * 0.47} ${cx},${h * 0.48} Q${cx + w * 0.2},${h * 0.47} ${cx + w * 0.22},${h * 0.78}"/>`;
  }
  if (/wide|establishing/i.test(shot.shot) || /room|house|venue|shelves|salon|kitchen|street|hillside|classroom|stage|balcony|garden|building/i.test(t)) {
    return `<path d="M0,${h * 0.62} Q${w * 0.3},${h * 0.55} ${w * 0.55},${h * 0.6} T${w},${h * 0.58}"/><path d="M${cx - w * 0.18},${h * 0.6} v-${h * 0.13} l${w * 0.18},-${h * 0.1} l${w * 0.18},${h * 0.1} v${h * 0.13}"/>`;
  }
  if (/top-down/i.test(shot.shot) || /table|plate|dish|bite/i.test(t)) {
    return `<circle cx="${cx}" cy="${h * 0.48}" r="${Math.min(w, h) * 0.26}"/><circle cx="${cx}" cy="${h * 0.48}" r="${Math.min(w, h) * 0.17}" stroke-dasharray="3 4"/>`;
  }
  const pw = w * 0.3;
  const ph = Math.min(h * 0.42, pw * 1.9);
  return `<rect x="${cx - pw / 2}" y="${h * 0.47 - ph / 2}" width="${pw}" height="${ph}" rx="${pw * 0.14}"/><path d="M${cx - pw * 0.3},${h * 0.47 - ph * 0.35} l${pw * 0.25},-${ph * 0.08}" stroke-opacity="0.8"/>`;
}

const PALETTE = [["#20264a", "#0c0f20"], ["#2a1f45", "#110c1f"], ["#173444", "#0a1820"], ["#3a2a1c", "#150e08"]];

export function frameSvg(shot: StoryShot, o: { ratio: string; uid: string; index: number; at: number; thumb: string | null; label?: string; from?: number; to?: number }): string {
  const { w, h } = frameSize(o.ratio);
  const [c1, c2] = PALETTE[o.index % PALETTE.length];
  const g = `g-${o.uid}`;
  const m = `m-${o.uid}`;
  const r = Math.min(w, h) * 0.13;
  const zoom = o.thumb ? (shot.cameraId === "push-in" ? 1.12 : shot.cameraId === "pull-out" ? 0.94 : 1) : 1;
  const photo = o.thumb
    ? `<image href="${esc(o.thumb)}" x="${(w - w * zoom) / 2}" y="${(h - h * zoom) / 2}" width="${w * zoom}" height="${h * zoom}" preserveAspectRatio="xMidYMid slice" opacity="0.88"/>`
    : `<g fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2">${subjectSketch(shot, w, h)}</g>`;
  const chars = Math.max(14, Math.floor(w / 6.2));
  const band = Math.min(54, h * 0.34);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(`Shot ${shot.n}: ${shot.shot}, ${shot.camera}. ${shot.action}`)}">`,
    `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`,
    `<marker id="${m}" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#ffd166"/></marker></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#${g})"/>`,
    photo,
    `<g fill="none" stroke="#ffd166" stroke-width="2.2" stroke-linecap="round">${cameraGlyph(shot.cameraId, w / 2, h * 0.45, r, m)}</g>`,
    `<rect width="${w}" height="22" fill="#000" fill-opacity="0.45"/>`,
    `<text x="8" y="15" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="700" fill="#fff">${esc(`SHOT ${o.label ?? shot.n} · ${o.from ?? shot.from}–${o.to ?? shot.to} s`)}</text>`,
    `<text x="${w - 8}" y="15" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="9" font-weight="700" fill="#ffd166">PREVIEW</text>`,
    `<rect y="${h - band}" width="${w}" height="${band}" fill="#000" fill-opacity="0.6"/>`,
    `<text x="8" y="${h - band + 17}" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="700" fill="#fff">${esc(cut(shot.shot, chars))}</text>`,
    `<text x="8" y="${h - band + 32}" font-family="Inter, Arial, sans-serif" font-size="10" fill="#ffd166">${esc(cut(shot.camera, chars))}</text>`,
    band > 44 ? `<text x="8" y="${h - band + 46}" font-family="Inter, Arial, sans-serif" font-size="9" fill="#cfd3e6">${esc(cut(shot.references.length ? `Uses ${shot.references.join(", ")}` : shot.sound ? `Sound: ${shot.sound}` : `at ${o.at} s`, chars + 4))}</text>` : "",
    `</svg>`,
  ].join("");
}

const WAIT: Record<SeedanceRequest["tier"], string> = { mini: "about 3 to 4 minutes", fast: "about 4 to 5 minutes", pro: "about 6 to 7 minutes" };

/**
 * The storyboard for a request. `thumbs` are small data-URL photos for the image references, in order (null when a
 * photo could not be read); `credits` is what the real clip will cost.
 */
export function buildStoryboard(input: { id: string; title: string; request: SeedanceRequest; referenceNotes: string[]; thumbs: (string | null)[]; credits: number }): Storyboard {
  const r = input.request;
  const seconds = Math.min(15, Math.max(4, Math.round(r.seconds)));
  const { setting, shots } = parseShots(r.prompt, seconds, r.fixedLens);
  let image = 0;
  const references: StoryReference[] = r.references.map((ref, i) => ({
    label: input.referenceNotes[i] ?? `${ref.kind[0].toUpperCase()}${ref.kind.slice(1)}`,
    kind: ref.kind,
    thumb: ref.kind === "image" ? (input.thumbs[image++] ?? null) : null,
  }));
  const imageThumbs = references.filter((x) => x.kind === "image").map((x) => x.thumb);
  const frames = keyMoments(shots).map(({ at, shot, label, from, to }, i) => {
    const imageRef = shot.references.find((x) => x.startsWith("Image "));
    const thumb = imageRef ? (imageThumbs[Number(imageRef.split(" ")[1]) - 1] ?? null) : null;
    return { at, shot: shot.n, label, from, to, caption: `${shot.shot}, ${shot.camera}: ${shot.action}`, svg: frameSvg(shot, { ratio: r.ratio, uid: `${input.id}-${i}`, index: i, at, thumb, label, from, to }) };
  });
  const check = checkSeedanceRequest(r, { referenceNotes: input.referenceNotes });
  return {
    kind: "seedance-storyboard",
    notice: PREVIEW_NOTICE,
    title: input.title,
    model: SEEDANCE_MODELS[r.tier]?.name ?? r.tier,
    tier: r.tier,
    resolution: r.draft ? "480p" : r.resolution,
    ratio: r.ratio,
    seconds,
    audio: r.audio,
    fixedLens: r.fixedLens,
    setting,
    prompt: r.prompt,
    shots,
    frames,
    references,
    estimate: { usd: estimateSeedanceUsd({ tier: r.tier, resolution: r.draft ? "480p" : r.resolution, seconds }), credits: input.credits, wait: r.flex ? "up to a few hours (offline)" : WAIT[r.tier] },
    issues: check.issues,
  };
}
