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

export function judgePrompt(edl: Edl | null): string {
  const plan = edl ? edl.segments.map((s) => `${s.start.toFixed(1)}-${s.end.toFixed(1)} s ${s.id} (${s.source})`).join("; ") : "";
  return `You are a creative director at a performance-marketing agency judging a vertical UGC-style video ad (up to 30 s) for BuPulse (an AI marketing app; the name is said "Boo-pulse"). Watch AND listen to the whole video.
${plan ? `The plan's segments: ${plan}.` : ""}
Judge it as a social ad for small-business owners in Rwanda, against other short-form ads. UGC should look like phone footage: that is a strength, not a flaw. Judge the creative craft only; the hard-rule checks below are separate and must not lower these scores.
Score each 0-10 and use the whole scale:
- thumbStop: do the first 2 seconds stop a scrolling viewer (a question, a confession, a pattern break, motion)?
- retention: is there a reason to keep watching to the end (a twist, a story, rising energy, cuts on the beat)?
- productClarity: after watching, do you know what BuPulse does and see it working on real screens?
- wow: a memorable moment (a transformation, a reveal, a freeze-frame, a beat drop) that people would rewatch or share.
- humour: is it genuinely funny or charming (0-3 when it does not try)?
- sound: clear voice, music that fits and stays under the voice, effects that land.
- overall, with these anchors:
  9-10: a scroll-stopping concept built on an identity twist, transformation or reveal that pays off on the product, edits synced to the music, real screens, a strong finish.
  8: a strong format without that twist: a funny story (freeze-frame, rewind, loop), a demo or a split-screen, with a clear wow or humour moment, real product screens and good pacing.
  7: a competent creator talking straight to camera with captions and an end card, even short and without product screens: clear and believable but ordinary, little surprise.
  6: flat or slow, or the message is unclear.
  5 or less: broken (bad audio, obvious AI artefacts, confusing).
A short ad (under 30 s) is not marked down for its length.
Hard-rule checks (true/false):
- fakeScreen: is any phone, laptop or app screen visibly AI-drawn, blank or gibberish? (Real dashboard screenshots are fine.)
- watermark: is there a burned-in "AI-generated" label or watermark?
- spokenCta: does a person SAY the call to action (go to bupulse dot com) near the end?
- musicTooLoud: does the music cover or fight the voices anywhere?
- kinyarwandaAiVoice: does an AI voice speak Kinyarwanda?
Then the weakest moment ("at": seconds from the start, "why") and the single most important fix, written as an instruction for re-making that moment's picture or line.
Return JSON only: {"scores": {"thumbStop": n, "retention": n, "productClarity": n, "wow": n, "humour": n, "sound": n}, "overall": n, "checks": {"fakeScreen": b, "watermark": b, "spokenCta": b, "musicTooLoud": b, "kinyarwandaAiVoice": b}, "weakest": {"at": n, "why": "..."}, "fix": "...", "summary": "one or two sentences"}`;
}

/** The judge looks twice (two calls at once, about $0.006 each): one look can swing a point. */
export const JUDGE_LOOKS = 2;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const halfPoint = (x: number) => Math.round(x * 2) / 2;

/**
 * Several looks at the same ad as one answer: scores averaged (to the half point), a hard rule broken when ANY look
 * saw it (the safe side), the weakest moment and fix from the harshest look. Calibrated on 11 Nov 2026 against the
 * owner's hand scores (tests/ad-brain/judge-calibration.test.ts).
 */
export function combineJudgements(looks: JudgeAnswer[]): JudgeAnswer {
  if (looks.length === 0) throw new Error("No judgement to combine.");
  if (looks.length === 1) return looks[0];
  const harshest = [...looks].sort((a, b) => a.overall - b.overall)[0];
  const keys = Object.keys(looks[0].scores) as (keyof JudgeAnswer["scores"])[];
  return {
    scores: Object.fromEntries(keys.map((k) => [k, halfPoint(mean(looks.map((l) => l.scores[k])))])) as JudgeAnswer["scores"],
    overall: halfPoint(mean(looks.map((l) => l.overall))),
    checks: {
      fakeScreen: looks.some((l) => l.checks.fakeScreen),
      watermark: looks.some((l) => l.checks.watermark),
      spokenCta: looks.every((l) => l.checks.spokenCta),
      musicTooLoud: looks.some((l) => l.checks.musicTooLoud),
      kinyarwandaAiVoice: looks.some((l) => l.checks.kinyarwandaAiVoice),
    },
    weakest: harshest.weakest,
    fix: harshest.fix,
    summary: harshest.summary,
  };
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
