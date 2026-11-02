// The skit video's prompt for Seedance 2.0 reference-to-video: the scene, each person with their look and their voice
// note (Audio 1 is speaker 1...), the lines in order so the lips follow the voice, the business's pictures as the setting
// and product. References are named both ways ("@Image1", "Audio 1"): Seedance's own docs use "Image 1", the hosted
// versions "@Image1". Pure.
import { SKIT_SECONDS, type SkitLine, type SkitSpeaker } from "./shared";

export type SkitPromptInput = { businessName: string; scene: string; speakers: SkitSpeaker[]; lines: SkitLine[]; language: string; imageCount: number; seconds?: number };

export function skitVideoPrompt(s: SkitPromptInput): string {
  const people = s.speakers.map((p, i) => `Person ${i + 1}, ${p.name}${p.look ? ` (${p.look})` : ""}, speaks with the voice of @Audio${i + 1} (Audio ${i + 1}).`);
  const lines = s.lines.map((l) => `Person ${l.speaker}: "${l.text}"`);
  return [
    `A ${s.seconds ?? SKIT_SECONDS}-second vertical social media skit for ${s.businessName}, filmed like a real phone video in East Africa, natural light, handheld but steady.`,
    s.scene,
    ...people,
    `They talk in ${s.language}, in this order, with their lips matching their own voice exactly; only the person speaking moves their lips:`,
    ...lines,
    s.imageCount > 0 ? `Use the reference pictures (@Image1${s.imageCount > 1 ? ` to @Image${s.imageCount}` : ""}) for the place and the product, shown as they are.` : null,
    "Real-looking people, no on-screen text, no subtitles, no logos added, no music over the voices.",
  ]
    .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    .join("\n");
}
