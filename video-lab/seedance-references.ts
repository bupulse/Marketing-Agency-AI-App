// Seedance references as BytePlus can take them (docs/VIDEO_ENGINE.md, "What Seedance 2.0 takes"). The studio runs on
// a laptop, so a localhost link is useless to BytePlus. From the ModelArk API reference (Create a video generation
// task, read 17 October 2026):
// - Images: a public URL, a Base64 data URL ("data:image/<format, lowercase>;base64,...") or asset://<id>. jpeg, png,
//   webp, bmp, tiff, gif (heic, heif on 2.0); width and height 300-6000 px; width/height between 0.4 and 2.5; under
//   30 MB each. Seedance 2.0: 1-9 reference images, or 1 first frame, or a first and a last frame.
// - Videos: a public URL or asset://<id> only (no Base64). mp4 or mov; 2-15 s each, at most 3 and 15 s in all; 300-6000
//   px, 0.4-2.5, 407,696 to 8,295,044 pixels; 24-60 fps; under 200 MB.
// - Audio: a public URL, a Base64 data URL ("data:audio/<wav|mp3>;base64,...") or asset://<id>. wav or mp3; 2-15 s each,
//   at most 3 and 15 s in all; under 15 MB. Not alone: at least one image or video with it.
// - The whole request body: at most 64 MB ("do not use Base64 for large files").
// So photos and cut-outs go inline, downscaled to fit; videos go as a public link through the tunnel
// (STUDIO_PUBLIC_URL, e.g. https://video.bupulse.com) only when it answers, never assumed.
import sharp from "sharp";
import { SEEDANCE_LIMITS, type SeedanceReference } from "@/lib/video-engine/seedance";
import { readMp4Table } from "@/lib/video-engine/video-source";

export const REFERENCE_LIMITS = {
  image: { minSide: 300, maxSide: 6000, minAspect: 0.4, maxAspect: 2.5, maxBytes: 30 * 1024 * 1024 },
  video: { minSeconds: 2, maxSeconds: 15, totalSeconds: 15, minSide: 300, maxSide: 6000, minPixels: 407_696, maxPixels: 8_295_044, minFps: 24, maxFps: 60, maxBytes: 200 * 1024 * 1024 },
  audio: { minSeconds: 2, maxSeconds: 15, totalSeconds: 15, maxBytes: 15 * 1024 * 1024 },
  /** BytePlus's limit is 64 MB; we keep the inline data under 48 MB so the prompt and JSON always fit. */
  bodyBytes: 64 * 1024 * 1024,
  inlineBudget: 48 * 1024 * 1024,
} as const;
/** Aspect ratios kept just inside BytePlus's open interval (0.4, 2.5). */
const ASPECT = { min: 0.42, max: 2.38 };
/** Longest side tried for inline images, best first; smaller only when the request would be too big. */
const MAX_SIDES = [2048, 1536, 1024, 768];

/** What a reference is made from. `label` is what the prompt calls it ("Image 1: <label>"). */
export type ReferenceSource =
  | { kind: "image"; type: "photo" | "cutout" | "portrait"; bytes: Buffer; label: string; role?: "first_frame" | "last_frame" | "reference_image" }
  | { kind: "image"; type: "asset"; asset: string; label: string; role?: "first_frame" | "last_frame" | "reference_image" }
  | { kind: "video"; bytes: Buffer; label: string; /** The studio path that serves it, e.g. /videos/seedance/sd-....mp4 */ publicPath: string }
  | { kind: "audio"; bytes: Buffer; mimeType: string; label: string };

/** One reference as it will be sent, for the dry run and the page (sizes, never bytes). */
export type ReferenceSummary = {
  name: string;
  label: string;
  role: string;
  type: string;
  how: "inline" | "public link" | "asset id";
  format: string | null;
  width: number | null;
  height: number | null;
  seconds: number | null;
  bytes: number | null;
  /** What was done to fit BytePlus's limits (scaled, padded...). */
  changes: string[];
};

export type PreparedReferences = { references: SeedanceReference[]; notes: string[]; summary: ReferenceSummary[]; problems: string[] };

const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

/**
 * An image made to fit: turned upright, padded to an aspect ratio BytePlus accepts (a photo with its own dominant
 * colour, a cut-out with transparency), scaled so the long side is at most `maxSide` and the short side at least
 * 300 px, then JPEG for photos and portraits, PNG for cut-outs (keeps the transparency).
 */
export type Decoded = { data: Buffer; info: { width: number; height: number; channels: 1 | 2 | 3 | 4 } };
/** The image turned upright and decoded once, so trying several sizes does not decode it again. */
export async function decodeUpright(bytes: Buffer): Promise<Decoded> {
  const out = await sharp(bytes).rotate().raw().toBuffer({ resolveWithObject: true });
  return { data: out.data, info: { width: out.info.width, height: out.info.height, channels: out.info.channels } };
}

export async function fitImage(input: Buffer | Decoded, type: "photo" | "cutout" | "portrait", maxSide = MAX_SIDES[0]): Promise<{ data: Buffer; format: "jpeg" | "png"; width: number; height: number; changes: string[] }> {
  const upright = Buffer.isBuffer(input) ? await decodeUpright(input) : input;
  const raw = () => sharp(upright.data, { raw: upright.info });
  let { width: w, height: h } = upright.info;
  const changes: string[] = [];
  let img = raw();
  const png = type === "cutout";
  const aspect = w / h;
  if (aspect < ASPECT.min || aspect > ASPECT.max) {
    const W = aspect < ASPECT.min ? Math.ceil(h * ASPECT.min) : w;
    const H = aspect > ASPECT.max ? Math.ceil(w / ASPECT.max) : h;
    const { dominant } = await raw().stats();
    const background = png ? { r: 0, g: 0, b: 0, alpha: 0 } : { ...dominant, alpha: 1 };
    const left = Math.floor((W - w) / 2);
    const top = Math.floor((H - h) / 2);
    const padded = await img.extend({ left, right: W - w - left, top, bottom: H - h - top, background }).raw().toBuffer({ resolveWithObject: true });
    img = sharp(padded.data, { raw: { width: padded.info.width, height: padded.info.height, channels: padded.info.channels } });
    changes.push(`padded from ${w}×${h} to ${W}×${H} (BytePlus takes width/height 0.4 to 2.5)`);
    w = W;
    h = H;
  }
  let k = Math.min(1, maxSide / Math.max(w, h));
  if (Math.min(w, h) * k < REFERENCE_LIMITS.image.minSide) k = REFERENCE_LIMITS.image.minSide / Math.min(w, h);
  const W = Math.round(w * k);
  const H = Math.round(h * k);
  if (W !== w || H !== h) {
    img = img.resize({ width: W, height: H, fit: "fill" });
    changes.push(`${k < 1 ? "scaled down" : "scaled up"} from ${w}×${h} to ${W}×${H}`);
  }
  const data = png ? await img.png({ compressionLevel: 9 }).toBuffer() : await img.flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
  return { data, format: png ? "png" : "jpeg", width: W, height: H, changes };
}

/** wav, mp3 or null, from the bytes first and the declared type second. */
export function audioFormat(bytes: Buffer, mimeType: string): "wav" | "mp3" | null {
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WAVE") return "wav";
  if (bytes.subarray(0, 3).toString("latin1") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  return /wav/i.test(mimeType) ? "wav" : /mpeg|mp3/i.test(mimeType) ? "mp3" : null;
}

/** A wav file's length in seconds from its header (null when it cannot be read). */
export function wavSeconds(bytes: Buffer): number | null {
  if (audioFormat(bytes, "") !== "wav" || bytes.length < 44) return null;
  const byteRate = bytes.readUInt32LE(28);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.subarray(at, at + 4).toString("latin1");
    const size = bytes.readUInt32LE(at + 4);
    if (id === "data") return byteRate ? Math.min(size, bytes.length - at - 8) / byteRate : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

/** The tunnel's public address, only when it is set, https, not local, and answers for `path` (HEAD, 8 s). */
export async function publicLink(path: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<{ url: string } | { problem: string }> {
  const base = env.STUDIO_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!base) return { problem: "BytePlus takes reference videos only as a public link, and the studio is on this laptop. Start the video.bupulse.com tunnel and set STUDIO_PUBLIC_URL in .env, or remove the video." };
  let host = "";
  try {
    const u = new URL(base);
    if (u.protocol !== "https:") return { problem: "STUDIO_PUBLIC_URL must start with https:// (BytePlus downloads from the internet)." };
    host = u.hostname;
  } catch {
    return { problem: "STUDIO_PUBLIC_URL is not a web address. Use the tunnel's address, e.g. https://video.bupulse.com." };
  }
  if (/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(host) || !host.includes(".")) return { problem: "STUDIO_PUBLIC_URL points at this computer; BytePlus needs the public tunnel address." };
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    if (res.ok) return { url };
    return { problem: `The tunnel answered ${res.status} for the video (${url}). Check that the studio is running behind it.` };
  } catch {
    return { problem: `The tunnel (${base}) does not answer. Start it, or remove the video from the references.` };
  }
}

/**
 * Turns the studio's references into what BytePlus takes, in the order given (the prompt numbers each kind from 1 in
 * that order: Image 1, Image 2, Video 1...). Images go inline, made to fit and shrunk further if the request would
 * pass 48 MB; videos go as a public link through the tunnel; audio goes inline. Anything BytePlus would refuse is
 * left out and explained in `problems`, in plain English.
 */
export async function prepareSeedanceReferences(sources: ReferenceSource[], opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; inlineBudget?: number } = {}): Promise<PreparedReferences> {
  const budget = opts.inlineBudget ?? REFERENCE_LIMITS.inlineBudget;
  const problems: string[] = [];
  const counts = { image: 0, video: 0, audio: 0 };
  const limit = { image: SEEDANCE_LIMITS.maxImages, video: SEEDANCE_LIMITS.maxVideos, audio: SEEDANCE_LIMITS.maxAudio };
  const keep = sources.filter((s) => {
    if (counts[s.kind] >= limit[s.kind]) {
      problems.push(`${cap(s.kind)} "${s.label}" left out: Seedance 2.0 takes at most ${limit[s.kind]} ${s.kind === "audio" ? "audio files" : `${s.kind}s`}.`);
      return false;
    }
    counts[s.kind] += 1;
    return true;
  });

  const decoded = new Map<ReferenceSource, Decoded | null>();
  for (const s of keep) if (s.kind === "image" && s.type !== "asset") decoded.set(s, await decodeUpright(s.bytes).catch(() => null));
  for (const maxSide of MAX_SIDES) {
    const out: { ref: SeedanceReference; summary: ReferenceSummary; inline: number }[] = [];
    const local: string[] = [];
    const n = { image: 0, video: 0, audio: 0 };
    let videoSeconds = 0;
    let audioSeconds = 0;
    for (const s of keep) {
      const name = `${cap(s.kind)} ${n[s.kind] + 1}`;
      const skip = (why: string) => local.push(`${name} (${s.label}) left out: ${why}`);
      if (s.kind === "image" && s.type === "asset") {
        const asset = s.asset.startsWith("asset://") ? s.asset : `asset://${s.asset}`;
        n.image += 1;
        out.push({ ref: { kind: "image", url: asset, role: s.role ?? "reference_image" }, summary: { name, label: s.label, role: s.role ?? "reference_image", type: "digital character", how: "asset id", format: null, width: null, height: null, seconds: null, bytes: null, changes: [] }, inline: 0 });
      } else if (s.kind === "image") {
        let fit;
        try {
          const d = decoded.get(s);
          if (!d) throw new Error("unreadable");
          fit = await fitImage(d, s.type, maxSide);
        } catch {
          skip("the image could not be read.");
          continue;
        }
        if (fit.data.length >= REFERENCE_LIMITS.image.maxBytes) {
          skip("it is over 30 MB even after resizing.");
          continue;
        }
        n.image += 1;
        const url = `data:image/${fit.format};base64,${fit.data.toString("base64")}`;
        out.push({ ref: { kind: "image", url, role: s.role ?? "reference_image" }, summary: { name, label: s.label, role: s.role ?? "reference_image", type: s.type, how: "inline", format: fit.format, width: fit.width, height: fit.height, seconds: null, bytes: fit.data.length, changes: fit.changes }, inline: url.length });
      } else if (s.kind === "video") {
        let t;
        try {
          t = readMp4Table(s.bytes.buffer.slice(s.bytes.byteOffset, s.bytes.byteOffset + s.bytes.byteLength) as ArrayBuffer);
        } catch {
          skip("it is not a readable MP4 (Seedance takes mp4 or mov).");
          continue;
        }
        const V = REFERENCE_LIMITS.video;
        const seconds = t.durationMs / 1000;
        const fps = t.samples.length / Math.max(0.001, seconds);
        const why =
          seconds < V.minSeconds || seconds > V.maxSeconds ? `it is ${seconds.toFixed(1)} s; each reference video must be 2 to 15 s.`
          : videoSeconds + seconds > V.totalSeconds + 0.05 ? `the reference videos would add up to ${(videoSeconds + seconds).toFixed(1)} s; Seedance 2.0 takes 15 s in all.`
          : s.bytes.length > V.maxBytes ? "it is over 200 MB."
          : Math.min(t.width, t.height) < V.minSide || Math.max(t.width, t.height) > V.maxSide ? `it is ${t.width}×${t.height}; each side must be 300 to 6000 px.`
          : t.width / t.height < 0.4 || t.width / t.height > 2.5 ? `its shape (${t.width}×${t.height}) is outside width/height 0.4 to 2.5.`
          : t.width * t.height < V.minPixels || t.width * t.height > V.maxPixels ? `it is ${t.width}×${t.height} (${t.width * t.height} pixels); BytePlus takes 407,696 to 8,295,044 pixels in all.`
          : fps < V.minFps - 0.5 || fps > V.maxFps + 0.5 ? `it runs at ${Math.round(fps)} fps; BytePlus takes 24 to 60.`
          : null;
        if (why) {
          skip(why);
          continue;
        }
        const link = await publicLink(s.publicPath, opts.env ?? process.env, opts.fetchImpl ?? fetch);
        if ("problem" in link) {
          skip(link.problem);
          continue;
        }
        n.video += 1;
        videoSeconds += seconds;
        out.push({ ref: { kind: "video", url: link.url, role: "reference_video" }, summary: { name, label: s.label, role: "reference_video", type: "video", how: "public link", format: "mp4", width: t.width, height: t.height, seconds: Math.round(seconds * 10) / 10, bytes: s.bytes.length, changes: [] }, inline: 0 });
      } else {
        const format = audioFormat(s.bytes, s.mimeType);
        const A = REFERENCE_LIMITS.audio;
        const seconds = format === "wav" ? wavSeconds(s.bytes) : null;
        const why = !format ? "Seedance takes .mp3 or .wav audio." : s.bytes.length > A.maxBytes ? "it is over 15 MB." : seconds !== null && (seconds < A.minSeconds || seconds > A.maxSeconds) ? `it is ${seconds.toFixed(1)} s; each audio file must be 2 to 15 s.` : seconds !== null && audioSeconds + seconds > A.totalSeconds + 0.05 ? "the audio files would add up to more than 15 s." : null;
        if (why) {
          skip(why);
          continue;
        }
        n.audio += 1;
        audioSeconds += seconds ?? 0;
        const url = `data:audio/${format};base64,${s.bytes.toString("base64")}`;
        out.push({ ref: { kind: "audio", url, role: "reference_audio" }, summary: { name, label: s.label, role: "reference_audio", type: "audio", how: "inline", format, width: null, height: null, seconds: seconds === null ? null : Math.round(seconds * 10) / 10, bytes: s.bytes.length, changes: format === "mp3" ? ["length not measured (mp3): keep it 2 to 15 s"] : [] }, inline: url.length });
      }
    }
    const inline = out.reduce((a, o) => a + o.inline, 0);
    const lastTry = maxSide === MAX_SIDES[MAX_SIDES.length - 1];
    if (inline > budget && !lastTry) continue;
    if (inline > budget) local.push(`The references come to ${kb(inline)} inline; BytePlus takes a 64 MB request at most. Use fewer images or a shorter audio file.`);
    if (n.audio && !n.image && !n.video) local.push("Audio needs at least one image or video with it on Seedance 2.0.");
    if (maxSide !== MAX_SIDES[0]) for (const o of out) if (o.summary.how === "inline" && o.summary.width) o.summary.changes.push(`kept to ${maxSide} px so the request stays under 64 MB`);
    // Labels as the prompt names them, numbered per kind in this order.
    const notes = out.map((o) => `${o.summary.name}: ${o.summary.label}`);
    return { references: out.map((o) => o.ref), notes, summary: out.map((o) => o.summary), problems: [...problems, ...local] };
  }
  return { references: [], notes: [], summary: [], problems };
}

/** The request body for printing: inline data replaced by a short description (what, how big), never the bytes. */
export function summariseBody(body: Record<string, unknown>, summary: ReferenceSummary[] = []): Record<string, unknown> {
  let i = 0;
  const content = (body.content as Record<string, unknown>[]).map((c) => {
    if (c.type === "text") return c;
    const key = c.type as string;
    const media = c[key] as { url: string };
    const s = summary[i++];
    const desc = media.url.startsWith("data:")
      ? `<${media.url.slice(5, media.url.indexOf(";"))} inline, ${kb((media.url.length - media.url.indexOf(",") - 1) * 0.75)}${s?.width ? `, ${s.width}×${s.height}` : ""}${s?.seconds ? `, ${s.seconds} s` : ""}>`
      : media.url;
    return { ...c, [key]: { url: desc }, ...(s ? { "(not sent) label": `${s.name}: ${s.label}` } : {}) };
  });
  return { ...body, content };
}
