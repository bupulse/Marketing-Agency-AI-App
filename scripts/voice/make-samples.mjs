// Voice samples for the owner (11 November 2026): the same ~15-second BuPulse script read by 5 Gemini TTS prebuilt
// voices and 3 ElevenLabs voices, with the TEST keys. Logs each call's cost. Never prints a key.
// node scripts/voice/make-samples.mjs .env <out dir>   (TEST keys; costs under $0.25 in all; docs/VOICE_AND_MUSIC.md)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const out = process.argv[3];
mkdirSync(out, { recursive: true });

export const SCRIPT = "Running a business is busy. Posting every day shouldn't be. BuPulse writes your posts, designs your pictures and makes your reels, ready every morning. Try BuPulse today, and watch your page come alive.";
const STYLE = "Read this short social media advert in clear, natural English, warm and confident, at a lively but easy pace:";
const GEMINI_MODEL = "gemini-3.8-flash-tts";
// USD per 1M tokens until 31 Dec 2026 (aistudio.google.com/docs/pricing).
const GEMINI_PRICE = { input: 0.5, output: 9 };
// ElevenLabs API price per 1,000 characters (elevenlabs.io/pricing/api): $0.08 for Multilingual v2; the plan overage rate
// used by the app's ledger is $0.30, shown as the upper bound.
const EL_PRICE = { api: 0.08, overage: 0.3 };

const GEMINI = ["Sulafat", "Achird", "Sadachbia", "Puck", "Aoede"];
const ELEVEN = [
  { id: "4SFJvuIUvxaPLgk8FoK3", name: "Alimata" },
  { id: "kRnE5e47lbU8Zg2MPQPm", name: "Moussa" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam" },
];

function wav(pcm, rate) {
  const b = Buffer.alloc(44 + pcm.length);
  b.write("RIFF", 0); b.writeUInt32LE(36 + pcm.length, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(pcm.length, 40); pcm.copy(b, 44);
  return b;
}

const log = [];
let total = 0;
for (const voice of GEMINI) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: `${STYLE}\n${SCRIPT}` }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
  });
  const j = await r.json().catch(() => ({}));
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!r.ok || !part) { log.push({ voice, provider: "gemini", status: r.status, error: j.error?.status ?? "no audio" }); continue; }
  let bytes = Buffer.from(part.inlineData.data, "base64");
  const isWav = bytes.subarray(0, 4).toString() === "RIFF";
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24000);
  if (!isWav) bytes = wav(bytes, rate);
  const file = join(out, `gemini-${voice.toLowerCase()}.wav`);
  writeFileSync(file, bytes);
  const u = j.usageMetadata ?? {};
  const cost = ((u.promptTokenCount ?? 0) * GEMINI_PRICE.input + (u.candidatesTokenCount ?? 0) * GEMINI_PRICE.output) / 1e6;
  total += cost;
  log.push({ voice, provider: "gemini", model: GEMINI_MODEL, mime: part.inlineData.mimeType, inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount, seconds: +((bytes.length - 44) / 2 / rate).toFixed(1), costUsd: +cost.toFixed(5), file });
  console.log(JSON.stringify(log.at(-1)));
}
for (const v of ELEVEN) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.id}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: SCRIPT, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!r.ok) { log.push({ voice: v.name, provider: "elevenlabs", status: r.status }); console.log(JSON.stringify(log.at(-1))); continue; }
  const bytes = Buffer.from(await r.arrayBuffer());
  const file = join(out, `elevenlabs-${v.name.toLowerCase()}.mp3`);
  writeFileSync(file, bytes);
  const chars = Number(r.headers.get("character-cost") ?? r.headers.get("x-character-count") ?? SCRIPT.length);
  const cost = (chars / 1000) * EL_PRICE.overage;
  total += cost;
  log.push({ voice: v.name, provider: "elevenlabs", model: "eleven_multilingual_v2", characters: chars, costUsdApiRate: +((chars / 1000) * EL_PRICE.api).toFixed(4), costUsdUpperBound: +cost.toFixed(4), file });
  console.log(JSON.stringify(log.at(-1)));
}
writeFileSync(join(out, "costs.json"), JSON.stringify({ script: SCRIPT, totalUsdUpperBound: +total.toFixed(4), calls: log }, null, 2));
console.log("total (upper bound) USD", total.toFixed(4));
