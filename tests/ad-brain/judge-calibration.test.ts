import { describe, expect, it } from "vitest";
import { combineJudgements, decideFix, JUDGE_LOOKS, PASS_SCORE, type JudgeAnswer } from "@/lib/ad-brain/judge";
import { judgeCopy, JUDGE_INLINE_MAX_BYTES } from "@/lib/ad-brain/render";
import { twistFixture } from "@/lib/ad-brain/fixtures";

// The judge's calibration (11 Nov 2026): the anchored rubric at 720p, temperature 0, two looks combined. The looks
// below are the real answers Gemini 3.8 Flash gave for the owner's hand-judged reference ads (~/bupulse-ugc-ads/final),
// two rounds each (about $0.006 a look). The owner's scores: "Who's real?" 9, "Yep, that's me" 8, 30 s split-screen 8,
// salon testimonial 7. The salon ad's voice is cut off at the end card and it carries an old "AI-generated" badge: the
// judge marks those real defects down, so it lands a point or two under the owner there.
type Scores = JudgeAnswer["scores"];
const look = (overall: number, s: [number, number, number, number, number, number], checks: Partial<JudgeAnswer["checks"]> = {}): JudgeAnswer => ({
  scores: { thumbStop: s[0], retention: s[1], productClarity: s[2], wow: s[3], humour: s[4], sound: s[5] } as Scores,
  overall,
  checks: { fakeScreen: false, watermark: false, spokenCta: true, musicTooLoud: false, kinyarwandaAiVoice: false, ...checks },
  weakest: { at: 5, why: "x" },
  fix: "y",
  summary: "",
});

const REFERENCES: { name: string; owner: number; looks: JudgeAnswer[] }[] = [
  { name: "Who's real? (twist)", owner: 9, looks: [look(9, [9, 9, 9, 9, 7, 8], { spokenCta: false }), look(9, [9, 9, 9, 9, 7, 9], { spokenCta: false })] },
  { name: "Yep, that's me (loop story)", owner: 8, looks: [look(8, [9, 9, 8, 8, 8, 8]), look(9, [9, 9, 8, 9, 8, 8])] },
  { name: "30 s split-screen reveal", owner: 8, looks: [look(8, [8, 7, 9, 6, 2, 8], { spokenCta: false }), look(8, [8, 7, 9, 6, 2, 8], { spokenCta: false })] },
  { name: "Salon testimonial", owner: 7, looks: [look(5, [5, 5, 5, 4, 4, 4], { spokenCta: false, watermark: true }), look(5, [6, 5, 5, 3, 2, 4], { spokenCta: false, watermark: true })] },
];

describe("the judge's calibration against the owner's scores", () => {
  it("looks twice", () => {
    expect(JUDGE_LOOKS).toBe(2);
  });

  it("lands on the owner's score for the twist and the split-screen, and within a point for the loop story", () => {
    const [twist, story, split] = REFERENCES.map((r) => combineJudgements(r.looks).overall);
    expect(twist).toBe(9);
    expect(split).toBe(8);
    expect(Math.abs(story - 8)).toBeLessThanOrEqual(1);
  });

  it("keeps the owner's order: the twist on top, the testimonial last", () => {
    const overall = REFERENCES.map((r) => combineJudgements(r.looks).overall);
    expect(overall[0]).toBeGreaterThanOrEqual(Math.max(...overall.slice(1)));
    expect(overall[3]).toBeLessThanOrEqual(Math.min(...overall.slice(0, 3)));
  });

  it("flags the hard rules any look saw: the salon's watermark, and the missing spoken call to action of the older ads", () => {
    const salon = combineJudgements(REFERENCES[3].looks);
    expect(salon.checks.watermark).toBe(true);
    expect(salon.checks.spokenCta).toBe(false);
    expect(combineJudgements(REFERENCES[1].looks).checks.spokenCta).toBe(true);
    // Under the pass mark, so the pipeline would re-make its weakest AI moment once.
    expect(salon.overall).toBeLessThan(PASS_SCORE);
  });

  it("combines looks: averages to the half point, takes the harshest look's weakest moment", () => {
    const a = look(9, [9, 9, 9, 9, 7, 9]);
    const b = { ...look(8, [8, 9, 8, 8, 7, 8]), weakest: { at: 12, why: "slow middle" } };
    const c = combineJudgements([a, b]);
    expect(c.overall).toBe(8.5);
    expect(c.scores.thumbStop).toBe(8.5);
    expect(c.weakest).toEqual({ at: 12, why: "slow middle" });
    expect(combineJudgements([a])).toBe(a);
    expect(() => combineJudgements([])).toThrow();
    expect(decideFix(c, twistFixture(), false).action).toBe("deliver");
  });

  it("sends the ad itself when it fits the request, else a 720p copy", async () => {
    expect(JUDGE_INLINE_MAX_BYTES).toBe(14 * 1024 * 1024);
    // A missing file cannot be measured: the re-encode is tried (and ffmpeg's failure falls back to the file).
    expect(await judgeCopy("/nonexistent/ad.mp4", "/nonexistent/out.mp4")).toBe("/nonexistent/ad.mp4");
  });
});
