// The judge (docs/AD_BRAIN.md, section 3.7-3.8): Gemini watches AND listens to the finished ad with a fixed rubric and
// the hard-rule checks; decideFix turns the answer into at most one fix (never a loop). The rubric scored the 10 Nov
// hand-made ads 9/8/8/7. Pure except for the prompt it builds.
import { z } from "zod";
import type { Edl } from "./edl";
import { segmentAt } from "./plan";

/** Below this overall score (or with a hard rule broken) one weak segment is re-rolled. */
export const PASS_SCORE = 7;

const score = z.coerce.number().min(0).max(10);
export const judgeSchema = z.object({
  scores: z.object({ thumbStop: score, retention: score, productClarity: score, wow: score, humour: score, sound: score }),
  overall: score,
  checks: z.object({ fakeScreen: z.boolean(), watermark: z.boolean(), spokenCta: z.boolean(), musicTooLoud: z.boolean(), kinyarwandaAiVoice: z.boolean().default(false) }),
  weakest: z.object({ at: z.coerce.number().min(0).max(120), why: z.string().max(400) }),
  fix: z.string().max(500),
  summary: z.string().max(600).default(""),
});
export type JudgeAnswer = z.infer<typeof judgeSchema>;

export function judgePrompt(edl: Edl): string {
  const plan = edl.segments.map((s) => `${s.start.toFixed(1)}-${s.end.toFixed(1)} s ${s.id} (${s.source})`).join("; ");
  return `You are a strict creative director judging a 30-second vertical UGC-style video ad for BuPulse (an AI marketing app; the name is said "Boo-pulse"). Watch AND listen to the whole video.
The plan's segments: ${plan}.
Score 0-10 (10 = top creator level): thumbStop (do the first 2 seconds stop a scrolling viewer?), retention (does it keep you to the end?), productClarity (do you understand what BuPulse does?), wow, humour, sound (voice clear, music fits, effects land), and overall as a social ad.
Hard-rule checks (true/false):
- fakeScreen: is any phone, laptop or app screen visibly AI-drawn, blank or gibberish? (Real dashboard screenshots are fine.)
- watermark: is there a burned-in "AI-generated" label or watermark?
- spokenCta: does a person SAY the call to action (go to bupulse dot com) near the end?
- musicTooLoud: does the music cover or fight the voices anywhere?
- kinyarwandaAiVoice: does an AI voice speak Kinyarwanda?
Then the weakest moment ("at": seconds from the start, "why") and the single most important fix, written as an instruction for re-making that moment's picture or line.
Return JSON only: {"scores": {"thumbStop": n, "retention": n, "productClarity": n, "wow": n, "humour": n, "sound": n}, "overall": n, "checks": {"fakeScreen": b, "watermark": b, "spokenCta": b, "musicTooLoud": b, "kinyarwandaAiVoice": b}, "weakest": {"at": n, "why": "..."}, "fix": "...", "summary": "one or two sentences"}`;
}

/** The hard rules the judge saw broken, in plain English. */
export function hardRuleFailures(a: JudgeAnswer): string[] {
  const out: string[] = [];
  if (a.checks.fakeScreen) out.push("an AI-drawn screen is visible");
  if (a.checks.watermark) out.push("a watermark is burned in");
  if (!a.checks.spokenCta) out.push("the call to action is not heard");
  if (a.checks.musicTooLoud) out.push("the music covers the voices");
  if (a.checks.kinyarwandaAiVoice) out.push("an AI voice speaks Kinyarwanda");
  return out;
}

export type FixDecision =
  | { action: "deliver"; note: string }
  /** Free: the music down 4 dB (and the voices kept), then render again. */
  | { action: "remix"; note: string }
  /** Paid: make one segment's picture again with the judge's fix in its prompt. */
  | { action: "reroll"; segmentId: string; beat: string; note: string };

/**
 * One fix at most: nothing when the ad passes (no hard rule broken, overall >= PASS_SCORE) or was fixed once already;
 * the music down when it is the only problem; else the weakest segment re-made when it is an AI picture (screens and
 * the end card are not re-rolled). Never loops.
 */
export function decideFix(a: JudgeAnswer, edl: Edl, fixedOnce: boolean): FixDecision {
  const broken = hardRuleFailures(a);
  if (!broken.length && a.overall >= PASS_SCORE) return { action: "deliver", note: `Passed: ${a.overall}/10.` };
  if (fixedOnce) return { action: "deliver", note: broken.length ? `Still flagged after one fix: ${broken.join(", ")}.` : `Scored ${a.overall}/10 after one fix.` };
  if (broken.length && broken.every((b) => b === "the music covers the voices" || b === "the call to action is not heard")) return { action: "remix", note: `The music goes down: ${broken.join(", ")}.` };
  const seg = segmentAt(edl, a.weakest.at);
  if (seg && (seg.source === "ai_clip" || seg.source === "ai_still_fx") && seg.beat) return { action: "reroll", segmentId: seg.id, beat: seg.beat, note: `Re-making "${seg.beat}": ${a.weakest.why}`.slice(0, 300) };
  return { action: "deliver", note: broken.length ? `Flagged (${broken.join(", ")}), and the weak moment is not an AI picture that can be re-made.` : `Scored ${a.overall}/10; the weak moment is a real screen or the end card, which are kept.` };
}

/** The ad with its music lowered by `db` (the remix fix), still inside the hard rule. */
export function lowerMusic(edl: Edl, db = 4): Edl {
  if (!edl.music) return edl;
  return { ...edl, music: { ...edl.music, gainDb: Math.max(-30, edl.music.gainDb - db) } };
}
