// Frames for the "video" layers of a spec (docs/VIDEO_ENGINE.md, "Seedance overlay"). drawSpecFrame stays synchronous
// and pure (the same frame always draws the same pixels): before each frame, the encoder or the live preview asks this
// helper for the clip frames that frame needs and puts them in the photos map, under one key per scene and layer; the
// renderer draws them like photos. Clips are opened once (video-source.ts) and read front to back, as decoding wants.
// Client-only for opening clips; videoFramesAt and videoFrameKey are pure.
import { scenesAt } from "./animate";
import { videoFrameKey, type Photos } from "./draw";
import type { MotionSpec } from "./spec";
import { VideoSource } from "./video-source";

export { videoFrameKey };

/** Each video layer the frame at `tMs` shows (the current scene and, during a transition, the previous one): its key, its clip and the time in it. */
export function videoFramesAt(spec: Pick<MotionSpec, "scenes">, tMs: number): { key: string; url: string; clipMs: number }[] {
  const { current, previous } = scenesAt(spec, tMs);
  const out: { key: string; url: string; clipMs: number }[] = [];
  for (const active of previous ? [previous, current] : [current]) {
    spec.scenes[active.index].layers.forEach((l, i) => {
      if (l.kind === "video") out.push({ key: videoFrameKey(active.index, i), url: l.url, clipMs: Math.round(l.start * 1000 + active.localMs) });
    });
  }
  return out;
}

/**
 * AI clips (Google Veo, /videos/veo/<id>.mp4) never keep their own sound, whatever a design or a hand edit says: Veo's
 * audio is always on and is not the business's (owner decision, 19 October 2026). The music and voice-over are used.
 */
export const isAiClipUrl = (url: string) => /\/videos\/veo\/vc-[0-9a-f]{12}\.mp4(\?|$)/.test(url);
const keepsSound = (l: { url: string; sound?: boolean }) => l.sound === true && !isAiClipUrl(l.url);

/** The distinct clips of a spec, and whether each keeps its own sound. */
export function videoClips(spec: Pick<MotionSpec, "scenes">): { url: string; sound: boolean }[] {
  const clips = new Map<string, boolean>();
  for (const s of spec.scenes) for (const l of s.layers) if (l.kind === "video") clips.set(l.url, (clips.get(l.url) ?? false) || keepsSound(l));
  return [...clips].map(([url, sound]) => ({ url, sound }));
}

/**
 * The clip sound to play (video layers with `sound`): per clip, one cue per scene, its piece of the clip (from the
 * layer's start for the scene's length) at the scene's start, in the same shape as the voice-over's cues (voice.ts).
 */
export function clipSoundCues(spec: Pick<MotionSpec, "scenes">): { url: string; cues: { scene: number; fromMs: number; toMs: number; atMs: number }[] }[] {
  const byUrl = new Map<string, { scene: number; fromMs: number; toMs: number; atMs: number }[]>();
  let at = 0;
  spec.scenes.forEach((s, scene) => {
    const ms = Math.round(s.seconds * 1000);
    for (const l of s.layers) {
      if (l.kind !== "video" || !keepsSound(l)) continue;
      const from = Math.round(l.start * 1000);
      byUrl.set(l.url, [...(byUrl.get(l.url) ?? []), { scene, fromMs: from, toMs: from + ms, atMs: at }]);
    }
    at += ms;
  });
  return [...byUrl].map(([url, cues]) => ({ url, cues }));
}

type Opener = (url: string) => Promise<{ frameAt(tMs: number): Promise<VideoFrame>; close(): void }>;

/**
 * Opens a spec's clips. `prepare(tMs, photos)` puts the frames the frame at `tMs` needs into `photos` (call it before
 * each drawSpecFrame, in time order); `close()` frees the decoders. A clip that cannot be opened is left out: its layer
 * draws black, and the rest of the video is made as usual.
 */
export async function openVideoFrames(spec: Pick<MotionSpec, "scenes">, open: Opener = (url) => VideoSource.open(url)): Promise<{ prepare(tMs: number, photos: Photos): Promise<void>; close(): void; failed: string[] }> {
  const sources = new Map<string, Awaited<ReturnType<Opener>>>();
  const failed: string[] = [];
  for (const { url } of videoClips(spec)) {
    try {
      sources.set(url, await open(url));
    } catch {
      failed.push(url);
    }
  }
  return {
    failed,
    async prepare(tMs, photos) {
      // One frame per clip per video frame: a source's frame is valid only until its next frameAt, so when one clip
      // shows in two scenes at once (a transition) both take the later scene's frame.
      const byUrl = new Map<string, { keys: string[]; clipMs: number }>();
      for (const need of videoFramesAt(spec, tMs)) {
        const have = byUrl.get(need.url);
        if (have) {
          have.keys.push(need.key);
          have.clipMs = need.clipMs;
        } else byUrl.set(need.url, { keys: [need.key], clipMs: need.clipMs });
      }
      for (const [url, { keys, clipMs }] of byUrl) {
        const source = sources.get(url);
        if (!source) continue;
        const frame = await source.frameAt(clipMs);
        for (const k of keys) photos.set(k, frame);
      }
    },
    close() {
      for (const s of sources.values()) s.close();
      sources.clear();
    },
  };
}
