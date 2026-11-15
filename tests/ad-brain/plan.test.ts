import { describe, expect, it } from "vitest";
import { validateEdl } from "@/lib/ad-brain/edl";
import { decideFix, hardRuleFailures, lowerMusic, type JudgeAnswer } from "@/lib/ad-brain/judge";
import { assetNeeds, buildEdl, needsCost, type Concept, type MadeAsset, type ScreenCapture } from "@/lib/ad-brain/plan";
import { recipeById } from "@/lib/ad-brain/recipes";
import { twistFixture } from "@/lib/ad-brain/fixtures";
import type { Script } from "@/lib/ad-brain/script-rules";

const recipe = recipeById("testimonial_screens")!;
const concept: Concept = { recipe: recipe.id, effects: ["punch_in", "browser_window", "slam", "whip_pan"], captionStyle: "karaoke", titleStyle: "slam", musicMood: "warm upbeat afrobeats", line: "A creator stops writing posts." };
const script: Script = {
  characters: [{ id: "amani", gender: "man", look: "A Rwandan man, late 20s, in a Kigali flat" }],
  beats: [
    { beat: "hook", line: { speaker: "amani", text: "I stopped writing my own Instagram posts.", source: "omni" }, title: "I STOPPED POSTING", action: "He shrugs and grins." },
    { beat: "montage", screens: [{ id: "posts", title: "A WEEK OF POSTS" }, { id: "cards", title: "WRITTEN FOR YOU" }, { id: "calendar", title: "POSTED ON TIME" }, { id: "home", title: "DONE" }] },
    { beat: "benefit", line: { speaker: "amani", text: "It writes, designs and posts my whole week.", source: "omni" } },
  ],
  cta: { speaker: "amani", text: "Check out BuPulse dot com and get a free quote.", source: "tts" },
  caption: "My posts write themselves now.",
  hashtags: ["BuPulse"],
  endCard: { headline: "Your week of posts, done", button: "Get a free quote", sub: "" },
};
const screens: ScreenCapture[] = ["posts", "cards", "calendar", "home"].map((id) => ({ id, page: "Posts", label: id, capturedAt: "2026-11-10", ref: `ad:${id}`, crop: [0, 0, 1, 1] }));
const words = (text: string, start: number) => text.split(" ").map((w, i) => ({ w, s: start + i * 0.4, e: start + i * 0.4 + 0.35 }));

describe("the planner", () => {
  it("lists what to make, with prompts that keep the hard rules", () => {
    const needs = assetNeeds(recipe, script, concept);
    expect(needs.map((n) => n.key)).toEqual(["char:amani", "clip:hook", "clip:benefit", "voice:end", "music:main"]);
    const clip = needs.find((n) => n.key === "clip:hook")!;
    expect(clip.kind === "clip" && clip.prompt).toMatch(/says exactly: "I stopped writing my own Instagram posts\."/);
    // Hard rule 1: AI pictures keep screens away; no text drawn by the AI.
    const portrait = needs.find((n) => n.key === "char:amani")!;
    expect(portrait.kind === "frame" && portrait.prompt).toMatch(/screen faces away from the camera/);
    expect(portrait.kind === "frame" && portrait.prompt).toMatch(/No text, no logos/);
    // The call to action says "free", so it is a TTS line with the brand spelled as it sounds.
    const voice = needs.find((n) => n.key === "voice:end")!;
    expect(voice.kind === "voice" && voice.text).toBe("Check out Boo Pulse dot com and get a free quote.");
    expect(needsCost(needs).reduce((s, l) => s + l.usd, 0)).toBeLessThan(3);
    expect(needsCost(needs, new Set(needs.map((n) => n.key)))).toEqual([]);
  });

  it("builds an EDL that passes its own checks from the made assets", () => {
    const made: Record<string, MadeAsset> = {
      "char:amani": { key: "char:amani", ref: "ad:p", kind: "image" },
      "clip:hook": { key: "clip:hook", ref: "ad:h", kind: "video", seconds: 5.04, words: words(script.beats[0].line!.text, 0.6) },
      "clip:benefit": { key: "clip:benefit", ref: "ad:b", kind: "video", seconds: 5.04, words: words(script.beats[2].line!.text, 0.5) },
      "voice:end": { key: "voice:end", ref: "ad:v", kind: "audio", seconds: 3.4, words: words("Check out Boo Pulse dot com and get a free quote.", 0.1) },
      "music:main": { key: "music:main", ref: "ad:m", kind: "audio", seconds: 30.7, bpm: 128, firstBeat: 0.4 },
    };
    const edl = buildEdl({ recipe, script, concept, made, screens, brand: { name: "BuPulse", url: "bupulse.com", primary: "#2f6bff", accent: "#7b5cff", logoRef: "repo:public/icon.png" } });
    const check = validateEdl(edl);
    expect(check.errors).toEqual([]);
    expect(edl.canvas.seconds).toBeGreaterThanOrEqual(20);
    expect(edl.canvas.seconds).toBeLessThanOrEqual(34);
    expect(edl.voice.at(-1)?.cta).toBe(true);
    expect(edl.segments.filter((s) => s.source === "real_screen").length).toBeGreaterThanOrEqual(3);
    // The signature transition lands between screens, the screens show in browser windows.
    expect(edl.segments.some((s) => s.transitionIn?.id === "whip_pan")).toBe(true);
    expect(edl.segments.filter((s) => s.source === "real_screen").every((s) => s.effects.some((e) => e.id === "browser_window"))).toBe(true);
  });

  it("falls back to a voice-over when Omni speech failed (the clip is silent)", () => {
    const fallback: Script = { ...script, beats: script.beats.map((b) => (b.beat === "benefit" && b.line ? { ...b, line: { ...b.line, source: "tts" as const } } : b)) };
    const needs = assetNeeds(recipe, fallback, concept);
    const clip = needs.find((n) => n.key === "clip:benefit")!;
    expect(clip.kind === "clip" && clip.speech).toBeNull();
    expect(clip.kind === "clip" && clip.prompt).toMatch(/does not speak/);
    expect(needs.some((n) => n.key === "voice:benefit")).toBe(true);
  });
});

const answer = (over: Partial<JudgeAnswer> = {}): JudgeAnswer => ({
  scores: { thumbStop: 8, retention: 8, productClarity: 8, wow: 8, humour: 7, sound: 8 },
  overall: 8,
  checks: { fakeScreen: false, watermark: false, spokenCta: true, musicTooLoud: false, kinyarwandaAiVoice: false },
  weakest: { at: 7.5, why: "flat delivery" },
  fix: "More energy.",
  summary: "",
  ...over,
});

describe("the judge's one fix", () => {
  const edl = twistFixture();

  it("delivers a passing ad as it is", () => {
    expect(decideFix(answer(), edl, false).action).toBe("deliver");
  });

  it("re-rolls the weakest AI segment once, never twice", () => {
    const d = decideFix(answer({ overall: 6 }), edl, false);
    expect(d).toMatchObject({ action: "reroll", segmentId: "transform", beat: "transform" });
    expect(decideFix(answer({ overall: 6 }), edl, true).action).toBe("deliver");
  });

  it("never re-rolls a real screen or the end card", () => {
    expect(decideFix(answer({ overall: 5, weakest: { at: 15, why: "x" } }), edl, false).action).toBe("deliver");
    expect(decideFix(answer({ overall: 5, weakest: { at: 29, why: "x" } }), edl, false).action).toBe("deliver");
  });

  it("lowers the music for free when that is the only problem", () => {
    const a = answer({ checks: { fakeScreen: false, watermark: false, spokenCta: true, musicTooLoud: true, kinyarwandaAiVoice: false } });
    expect(hardRuleFailures(a)).toEqual(["the music covers the voices"]);
    expect(decideFix(a, edl, false).action).toBe("remix");
    expect(lowerMusic(edl).music!.gainDb).toBe(edl.music!.gainDb - 4);
  });

  it("re-rolls when a hard rule is broken even with a good score", () => {
    const a = answer({ overall: 9, checks: { fakeScreen: true, watermark: false, spokenCta: true, musicTooLoud: false, kinyarwandaAiVoice: false }, weakest: { at: 1, why: "blank phone" } });
    expect(decideFix(a, edl, false)).toMatchObject({ action: "reroll", beat: "hook" });
  });
});
