// Generates the voiceover for every scene with ElevenLabs (with timestamps) and writes src/audio-manifest.json.
// Cached by text: only new or changed lines cost credits. Run: node scripts/voice.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CHAPTERS, VIDEOS } from "../src/script.ts";

const VOICE_ID = "NZ8KtusXpnktPYja5Qko"; // JB Pro (chosen 9 Oct 2026)
const MODEL = "eleven_multilingual_v2";
const SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.35 };

const env = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
const KEY = /^ELEVENLABS_API_KEY="?([^"\n]*)"?$/m.exec(env)?.[1];
if (!KEY) throw new Error("ELEVENLABS_API_KEY missing in .env");

type LineTiming = { start: number; end: number };
type SceneAudio = { file: string; duration: number; lines: LineTiming[] };
const manifest: Record<string, Record<string, SceneAudio>> = {};

async function tts(text: string) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS }),
    });
    if (res.ok) return (await res.json()) as { audio_base64: string; alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
    if (attempt >= 4) throw new Error(`TTS ${res.status}: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

for (const video of [...VIDEOS, { id: "chapters", title: "Chapters", scenes: Object.values(CHAPTERS) }]) {
  manifest[video.id] = {};
  for (const scene of video.scenes) {
    const enLines = scene.lines.map(([en]) => en);
    const text = enLines.join(" ");
    const hash = createHash("sha1").update(`${VOICE_ID}|${MODEL}|${JSON.stringify(SETTINGS)}|${text}`).digest("hex").slice(0, 12);
    const dir = `public/audio/voice`;
    mkdirSync(dir, { recursive: true });
    const file = `audio/voice/${hash}.mp3`;
    const meta = `${dir}/${hash}.json`;
    if (!existsSync(meta)) {
      const r = await tts(text);
      writeFileSync(`public/${file}`, Buffer.from(r.audio_base64, "base64"));
      // Line boundaries from character offsets.
      const ends = r.alignment.character_end_times_seconds;
      const starts = r.alignment.character_start_times_seconds;
      const lines: LineTiming[] = [];
      let offset = 0;
      for (const l of enLines) {
        const s = Math.min(offset, starts.length - 1);
        const e = Math.min(offset + l.length - 1, ends.length - 1);
        lines.push({ start: starts[s], end: ends[e] });
        offset += l.length + 1;
      }
      writeFileSync(meta, JSON.stringify({ duration: ends[ends.length - 1], lines }));
      console.log("generated", video.id, scene.id);
    }
    const m = JSON.parse(readFileSync(meta, "utf8"));
    manifest[video.id][scene.id] = { file, duration: m.duration, lines: m.lines };
  }
}
writeFileSync("src/audio-manifest.json", JSON.stringify(manifest, null, 1));
console.log("manifest written");
