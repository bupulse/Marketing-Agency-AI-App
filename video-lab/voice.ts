// Video Lab voice-overs (docs/VIDEO_ENGINE.md, "Voice-over"): speaks a design's `say` lines with ElevenLabs
// (lib/video-engine/voice.ts), keeps the MP3 and its timings in video-lab/data/voice/<hash>.mp3 (+ .json) so the same
// lines in the same voice are never paid for twice, and fits the design to the voice. Paid: about $0.30 per 1,000
// characters (eleven_multilingual_v2), written to the lab's ledger before the answer is used, inside the daily cap.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { VOICE_MODEL, VoiceError, fitSpecToVoice, speakSpec, voiceCostUsd, voiceLines, voiceScript, type SpokenLine, type VoiceCue } from "@/lib/video-engine/voice";
import { DEFAULT_VOICE_ID, isVoiceId } from "@/lib/voice/voices";
import { DAILY_CAP_USD, record, spentToday } from "./store";

const DIR = path.resolve("video-lab/data/voice");

/** What the page needs to render with the voice: the fitted spec, the MP3's URL and where each line plays. */
export type JobVoice = {
  hash: string;
  /** Served by the lab at this path (readVoiceMp3). */
  url: string;
  spec: MotionSpec;
  cues: VoiceCue[];
  /** False when the lines were too long for 30 seconds and had to be cut. */
  fits: boolean;
  voiceId: string;
  characters: number;
  durationMs: number;
  /** What this call cost (0 when the take came from the cache). */
  costUsd: number;
  cached: boolean;
};

type Saved = { voiceId: string; model: string; characters: number; durationMs: number; lines: SpokenLine[] };

/** A take's identity: voice, model and the exact text (40 hex characters). */
export const voiceHash = (voiceId: string, model: string, text: string) => createHash("sha256").update(`${voiceId}\n${model}\n${text}`).digest("hex").slice(0, 40);

/** The MP3 of a take, or null. For the route GET /api/voice/<hash>.mp3 (VOICE_ROUTE). */
export async function readVoiceMp3(hash: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{40}$/.test(hash)) return null;
  return fs.readFile(path.join(DIR, `${hash}.mp3`)).catch(() => null);
}

/** The path the page fetches a take from; group 1 is the hash. */
export const VOICE_ROUTE = /^\/api\/voice\/([0-9a-f]{40})\.mp3$/;

/**
 * The voice-over of a design: from the cache, or one ElevenLabs call (recorded in the ledger under `jobId`). Null when
 * the design has no `say` lines. Throws an Error with a plain message (no key, budget used, service refused).
 */
export async function makeVoiceForJob(spec: MotionSpec, jobId: string, opts: { voiceId?: string | null; fetchImpl?: typeof fetch } = {}): Promise<JobVoice | null> {
  const lines = voiceLines(spec);
  if (lines.length === 0) return null;
  const voiceId = opts.voiceId && isVoiceId(opts.voiceId) ? opts.voiceId : DEFAULT_VOICE_ID;
  const { text } = voiceScript(lines);
  const hash = voiceHash(voiceId, VOICE_MODEL, text);
  const result = (saved: Saved, costUsd: number, cached: boolean): JobVoice => {
    const fitted = fitSpecToVoice(spec, saved);
    return { hash, url: `/api/voice/${hash}.mp3`, spec: fitted.spec, cues: fitted.cues, fits: fitted.fits, voiceId, characters: saved.characters, durationMs: saved.durationMs, costUsd, cached };
  };

  const cached = await fs
    .readFile(path.join(DIR, `${hash}.json`), "utf8")
    .then((t) => JSON.parse(t) as Saved)
    .catch(() => null);
  if (cached && (await fs.access(path.join(DIR, `${hash}.mp3`)).then(() => true, () => false))) return result(cached, 0, true);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set in .env.");
  const estimate = voiceCostUsd(text.length);
  const spent = await spentToday();
  if (spent + estimate > DAILY_CAP_USD) throw new Error(`Today's test budget is used: $${spent.toFixed(2)} of $${DAILY_CAP_USD.toFixed(2)}. More tomorrow (Kigali time).`);
  const usage = (characters: number) => [{ model: VOICE_MODEL, inputTokens: characters, outputTokens: 0, costUsd: voiceCostUsd(characters), billedTo: "api" as const, apiEquivalentUsd: voiceCostUsd(characters) }];
  let voice;
  try {
    voice = await speakSpec(spec, { apiKey, voiceId, model: VOICE_MODEL, fetchImpl: opts.fetchImpl });
  } catch (error) {
    // No answer, but ElevenLabs may still have spoken (and charged) the text: recorded as an estimate.
    if (error instanceof VoiceError && error.maybeCharged) await record(jobId, "elevenlabs-voice", usage(text.length));
    throw error;
  }
  if (!voice) return null;
  await record(jobId, "elevenlabs-voice", usage(voice.characters));
  const saved: Saved = { voiceId, model: voice.model, characters: voice.characters, durationMs: voice.durationMs, lines: voice.lines };
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${hash}.mp3`), voice.audio);
  await fs.writeFile(path.join(DIR, `${hash}.json`), JSON.stringify(saved));
  return result(saved, voice.costUsd, false);
}
