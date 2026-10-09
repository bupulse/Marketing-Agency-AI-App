// Prints the frame in a full video where a scene's voice is at fraction p: node scripts/frame-of.ts 02-starter social momo 0.7
// Mirrors plan() in src/DemoVideo.tsx.
import { readFileSync } from "node:fs";
import { VIDEOS } from "../src/script.ts";
const m = JSON.parse(readFileSync("src/audio-manifest.json", "utf8"));
const [id, variant, sceneId, p = "0.5"] = process.argv.slice(2);
let t = 0;
for (const s of VIDEOS.find((v) => v.id === id)!.scenes.filter((s) => variant === "demo" || !s.demoOnly)) {
  const a = m[id][s.id];
  const d = Math.round((0.35 + a.duration + (s.hold ?? (variant === "demo" ? 1.8 : 0.6))) * 30) + 12;
  if (s.id === sceneId) { console.log(t + Math.round(0.35 * 30) + Math.round(a.duration * 30 * Number(p))); break; }
  t += d - 12;
}
