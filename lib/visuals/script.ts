// Video scripts BuPulse can voice (docs/CONTENT_VISUALS.md, "Make a video"): one line per scene, a short shot
// direction in square brackets (for the owner who films it) and the line that is spoken and shown. The video plan
// adds the headline as the opening scene and the business name as the closing one, so the script itself stays within
// what a 10 to 30 second voiceover can say (lib/voice/speech.ts: about 15 characters a second). Pure and client-safe:
// the AI's prompt, the "Write my own script" helper and the tests share these rules.
import { scriptLines } from "./video-plan";

export const SCRIPT_RULES = {
  minScenes: 3,
  maxScenes: 5,
  /** Characters spoken per scene (the scene caption fits VIDEO_LIMITS.sceneText). */
  lineChars: 80,
  /** Characters spoken by the whole script, before the opening and closing scenes are added. */
  totalChars: 330,
  /** Longest script the owner may type (directions included). */
  maxLength: 1500,
} as const;

/** The rules as the AI writers read them (the pack writer and the script writer). */
export const SCRIPT_GUIDE = `A ${SCRIPT_RULES.minScenes} to ${SCRIPT_RULES.maxScenes} scene vertical video, 10 to 30 seconds with its voiceover. One line per scene: a short shot direction in square brackets, then the line that is spoken and shown on screen, for example "[Close-up of the bread coming out of the oven] Fresh every morning, still warm." Each spoken line at most ${SCRIPT_RULES.lineChars} characters, all spoken lines together at most ${SCRIPT_RULES.totalChars} characters. The first scene is the hook (the first 2 seconds), the last one the call to action. No timestamps, no scene numbers, no hashtags.`;

export type ScriptCheck = { scenes: string[]; spokenChars: number; seconds: number; problems: string[] };

/** What a script says scene by scene, how long its voiceover takes, and what is outside the rules. */
export function checkScript(script: string): ScriptCheck {
  const scenes = scriptLines(script);
  const spokenChars = scenes.reduce((n, s) => n + s.length, 0);
  const problems: string[] = [];
  if (scenes.length < SCRIPT_RULES.minScenes) problems.push(`Write at least ${SCRIPT_RULES.minScenes} scenes, one per line.`);
  if (scenes.length > SCRIPT_RULES.maxScenes) problems.push(`Use at most ${SCRIPT_RULES.maxScenes} scenes; the rest are left out.`);
  const long = scenes.filter((s) => s.length > SCRIPT_RULES.lineChars).length;
  if (long) problems.push(`${long === 1 ? "One line is" : `${long} lines are`} over ${SCRIPT_RULES.lineChars} characters: shorter lines read and sound better.`);
  if (spokenChars > SCRIPT_RULES.totalChars) problems.push(`About ${spokenChars} characters are spoken; keep it under ${SCRIPT_RULES.totalChars} so the voiceover fits 30 seconds.`);
  // About 15 characters a second (lib/voice/speech.ts MS_PER_CHAR), plus the opening and closing scenes.
  return { scenes, spokenChars, seconds: Math.round((spokenChars * 66) / 1000), problems };
}

/**
 * An AI script held to the rules: at most the scene count, each spoken line cut at a word, and the last body lines
 * dropped while the whole is too long (the call to action, the last line, is kept). Directions stay with their line;
 * hashtags go (they are not spoken).
 */
export function fitScript(script: string): string {
  const lines = script
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => scriptLines(l).length > 0);
  const parts = lines.map((line) => {
    const direction = line.match(/^\s*\[[^\]]*\]/)?.[0]?.trim() ?? "";
    const spoken = scriptLines(line).join(" ").replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").trim();
    return { direction, spoken: cut(spoken, SCRIPT_RULES.lineChars) };
  });
  let kept = parts.length > SCRIPT_RULES.maxScenes ? [...parts.slice(0, SCRIPT_RULES.maxScenes - 1), parts[parts.length - 1]] : parts;
  while (kept.length > SCRIPT_RULES.minScenes && kept.reduce((n, p) => n + p.spoken.length, 0) > SCRIPT_RULES.totalChars) kept = [...kept.slice(0, -2), kept[kept.length - 1]];
  return kept.map((p) => (p.direction ? `${p.direction} ${p.spoken}` : p.spoken)).join("\n");
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max);
  const space = room.lastIndexOf(" ");
  return (space > max / 2 ? room.slice(0, space) : room).replace(/[\s,;:\-–—]+$/, "");
}
