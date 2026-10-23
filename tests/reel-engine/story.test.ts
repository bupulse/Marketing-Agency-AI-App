import { describe, expect, it } from "vitest";
import { BEATS, buildReelSpec, directReel, REEL_CAMERAS, reelCostUsd, reelCuts, snapToBeat, spokenLine, subtitleOf, veoClipPrompt, type ReelPlan } from "@/lib/reel-engine/story";
import { totalMs } from "@/lib/video-engine/spec";
import { readReel, REEL_SYSTEM, reelPrompt, ruleReel, type ReelInput } from "@/lib/reel-engine/writer";
import { viralRecipe } from "@/lib/video-engine/brain/viral";

const beats = directReel([], "job-1");
const input: ReelInput = {
  business: { name: "LEAF", industry: "Agriculture", description: "Vertical hydroponic towers", audience: "Farmers", place: "Kigali, Rwanda", language: "Kinyarwanda", voice: null, colors: [] },
  subject: { name: "LEAF Hydro Tower", description: "Grows 30 plants in one square metre", price: "250,000 RWF", sellingPoints: [] },
  brief: null,
  language: "Kinyarwanda",
  presenter: "a Black Rwandan woman in her early thirties",
  beats,
  recent: [],
  sector: "agriculture",
};
const longFrame = "The presenter stands in a plastic-covered greenhouse outside Kigali holding a crate of lettuce next to the white LEAF tower, soft morning light through the dusty roof, crates and a hose on the wet floor.";
const motion = "She lifts the crate towards the camera and smiles as the camera slowly pushes in.";

describe("the reel's story", () => {
  it("has no idea the video model films badly (close-ups of hands, many copies of the product)", () => {
    const ideas = BEATS.flatMap((b) => b.variants.map((v) => v.idea)).join(" ");
    expect(ideas).not.toMatch(/Close shots of hands|Many of the product/);
  });

  it("is 4 beats in order, each a variant and camera the company had least, never the same camera twice", () => {
    expect(beats.map((b) => b.beat)).toEqual(["hook", "use", "result", "cta"]);
    expect(new Set(beats.map((b) => b.camera)).size).toBe(4);
    const next = directReel(beats.map(({ variant, camera }) => ({ variant, camera })), "job-2");
    expect(next.map((b) => b.variant)).not.toEqual(beats.map((b) => b.variant));
  });

  it("asks the video model for a human phone video in the right place, real physics, real sounds, and no words on screen", () => {
    const p = veoClipPrompt({ motion, line: "Muraho! Reba uko umusaruro wiyongera.", camera: "slow push-in", presenter: true }, "Kinyarwanda", "a greenhouse");
    expect(p).toContain("about 8 seconds, in a greenhouse.");
    expect(p).toContain('speaks to the camera in Kinyarwanda, clearly, warmly and with energy, lips in sync: "Muraho! Reba uko umusaruro wiyongera."');
    expect(p).toContain("Filmed on a phone by a friend");
    expect(p).toMatch(/every touch makes contact/);
    expect(p).toMatch(/never through them/);
    expect(p).toMatch(/At most two people/);
    expect(p).toMatch(/crisp real sounds/);
    expect(p).toContain("No text, captions, subtitles or logos added.");
    // The round-2 reel showed the phone on its tripod: the camera is never in the frame.
    expect(p).toContain("the camera is never seen");
    expect(REEL_CAMERAS.join(" ")).not.toMatch(/tripod/);
    expect(veoClipPrompt({ motion, line: "", camera: "static", presenter: false }, "English")).toContain("Only the natural sound of the place.");
    // A take the checker sent back is filmed again with what went wrong.
    expect(veoClipPrompt({ motion, line: "", camera: "static", presenter: false, avoid: ["2 s: her hand passes through the leaves"] }, "English")).toContain("avoid exactly this: 2 s: her hand passes through the leaves.");
  });

  it("edits like a viral reel: 30 seconds, three shots a clip with a punch-in, flash and whip cuts, big captions popping in, the hook sticker", () => {
    const plan: ReelPlan = { ...ruleReel(input), hook: "No land? No problem.", clips: ruleReel(input).clips.map((c, i) => ({ ...c, line: `Line ${i} has a few more words now`, stress: ["words"] })) };
    const spec = buildReelSpec(plan, ["a.mp4", "b.mp4", "c.mp4", "d.mp4"], { name: "LEAF", color: "#1B5E20" });
    expect(totalMs(spec)).toBe(30_000);
    expect(spec.scenes).toHaveLength(12);
    // Three shots of the same clip, its sound straight through, the middle one punched in by about 30%.
    expect(spec.scenes[0].layers[0]).toMatchObject({ kind: "video", url: "a.mp4", start: 0, sound: true });
    expect(spec.scenes[1].layers[0]).toMatchObject({ kind: "video", url: "a.mp4", start: spec.scenes[0].seconds });
    expect(spec.scenes[2].layers[0]).toMatchObject({ kind: "video", url: "a.mp4", start: Math.round((spec.scenes[0].seconds + spec.scenes[1].seconds) * 100) / 100 });
    expect((spec.scenes[1].layers[0] as { keyframes: { scale: number }[] }).keyframes[0].scale).toBeGreaterThanOrEqual(1.3);
    expect([spec.scenes[1].transition, spec.scenes[2].transition]).toEqual(["cut", "cut"]);
    expect([3, 6, 9].map((i) => spec.scenes[i].transition)).toEqual(["flash", "whip", "zoom"]);
    // The hook's first cut comes fast, and every shot is short.
    expect(spec.scenes[0].seconds).toBeLessThan(2.5);
    expect(spec.scenes.every((s) => s.seconds >= 1.2 && s.seconds <= 3.6)).toBe(true);
    const captions = spec.scenes.flatMap((s) => s.layers).filter((l) => l.kind === "text" && l.animate === "wordsPop");
    expect(captions.map((l) => (l as { text: string }).text).join(" ")).toContain("Line 0 has a few more words now");
    expect((captions[0] as { size: number }).size).toBeGreaterThanOrEqual(0.075);
    expect(captions.some((l) => (l as { highlight: { words: string[] } | null }).highlight?.words[0] === "words")).toBe(true);
    expect(spec.scenes[0].layers.some((l) => l.kind === "text" && l.text === "No land? No problem." && l.uppercase)).toBe(true);
    const end = buildReelSpec({ ...plan, price: "250,000 RWF" }, ["a.mp4", "b.mp4", "c.mp4", "d.mp4"], { name: "LEAF", color: "#1B5E20", contact: "WhatsApp 0788 000 000" });
    const texts = (i: number) => end.scenes[i].layers.filter((l) => l.kind === "text").map((l) => (l as { text: string }).text);
    // The brand and the price first, then how to reach the business on its own; none of them before the last clip.
    expect(texts(10)).toEqual(expect.arrayContaining(["LEAF", "250,000 RWF"]));
    expect(texts(10)).not.toContain("WhatsApp 0788 000 000");
    expect(texts(11)).toEqual(expect.arrayContaining(["LEAF", "WhatsApp 0788 000 000"]));
    expect(end.scenes.slice(0, 10).some((s) => s.layers.some((l) => l.kind === "text" && ["LEAF", "250,000 RWF", "WhatsApp 0788 000 000"].includes(l.text)))).toBe(false);
    expect(reelCostUsd(0.8)).toBeCloseTo(3.5, 2);
  });

  it("puts every cut on the music's beat when it is known, and keeps 30 seconds and the clips' 8 seconds", () => {
    const beat = { period: 0.5, offset: 0.1 };
    const { lengths, cuts } = reelCuts(beat);
    expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(30, 5);
    expect(lengths.every((l) => l >= 6.8 && l <= 8)).toBe(true);
    let t = 0;
    for (let i = 0; i < 4; i++) {
      const onBeat = (x: number) => Math.abs(((x - 0.1) / 0.5) - Math.round((x - 0.1) / 0.5)) < 1e-6;
      if (i > 0) expect(onBeat(t)).toBe(true);
      expect(onBeat(t + cuts[i][0])).toBe(true);
      expect(onBeat(t + cuts[i][1])).toBe(true);
      t += lengths[i];
    }
    expect(reelCuts(null)).toEqual({ lengths: [7.5, 7.5, 7.5, 7.5], cuts: [[1.8, 4.65], [2.5, 5], [2.5, 5], [2.5, 5]] });
    expect(snapToBeat(3.6, 1, 5, null)).toBe(3.6);
  });
});

describe("the reel's writer", () => {
  it("fences the facts and asks for the lines in the reel's language", () => {
    const p = reelPrompt(input);
    expect(p).toContain("<<<DATA");
    expect(p).toContain("Language of the lines, the title and the caption: Kinyarwanda.");
    expect(p).toContain("The presenter: a Black Rwandan woman in her early thirties");
  });
  it("keeps good clips, drops a line that is too long or has an invented number, and refuses thin prompts", () => {
    const clips = beats.map((_, i) => ({ index: i, frame: longFrame, motion, line: i === 1 ? "Ubu twongereye umusaruro inshuro 3" : i === 2 ? "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen" : "Muraho neza!" }));
    const plan = readReel({ title: "Umusaruro", caption: "Reba!", hashtags: ["LEAF", "#Rwanda"], music: "afro", clips }, input)!;
    expect(plan.clips.map((c) => c.line)).toEqual(["Muraho neza!", "", "", "Muraho neza!"]);
    expect(plan.hashtags).toEqual(["#LEAF", "#Rwanda"]);
    expect(readReel({ clips: beats.map((_, i) => ({ index: i, frame: "short", motion, line: "" })) }, input)).toBeNull();
  });
});

describe("what is spoken", () => {
  // Google's video model refused the owner's first call to action 5 times because it said the price; without it, it filmed.
  const cta = "Iboneka ku mafaranga ibihumbi magana abiri na mirongo itanu. Twandikire kuri WhatsApp uyu munsi!";
  it("never says a price: that sentence is left out of the speech and the subtitle", () => {
    expect(spokenLine(cta)).toBe("Twandikire kuri WhatsApp uyu munsi!");
    expect(spokenLine("Only 250,000 RWF. Message us today!")).toBe("Message us today!");
    expect(spokenLine("The price is $40.")).toBe("");
    expect(spokenLine("Muraho! Reba uko umusaruro wiyongera.")).toBe("Muraho! Reba uko umusaruro wiyongera.");
    expect(subtitleOf(cta)).toBe("Twandikire kuri WhatsApp uyu munsi!");
    const p = veoClipPrompt({ motion, line: cta, camera: "handheld", presenter: true }, "Kinyarwanda");
    expect(p).not.toMatch(/amafaranga|ibihumbi/);
    expect(p).toContain('"Twandikire kuri WhatsApp uyu munsi!"');
  });
  it("a line that is only a price leaves the clip with its natural sound", () => {
    expect(veoClipPrompt({ motion, line: "Only 250,000 RWF.", camera: "handheld", presenter: true }, "English")).toContain("Only the natural sound of the place.");
  });
});

describe("the writer for any business", () => {
  it("puts the product where it is really used, from the business's sector", () => {
    expect(reelPrompt(input)).toMatch(/SETTING: a greenhouse, a farm field.*never a market/);
    expect(reelPrompt({ ...input, sector: "salon" })).toContain("SETTING: the salon chair");
    expect(REEL_SYSTEM).toMatch(/human, fun and interactive/);
    expect(REEL_SYSTEM).toMatch(/at most two people/);
  });
  it("follows a viral recipe's techniques when there is one", () => {
    const recipe = viralRecipe({ sector: "agriculture", product: "LEAF Hydro Tower", platform: "instagram", country: "Rwanda", purpose: "ad", seconds: 30, hasPrice: true, hasPhone: true, footage: { generated: true }, seed: "job-1" });
    const p = reelPrompt({ ...input, recipe });
    expect(p).toContain("VIRAL RECIPE");
    expect(p).toContain(`- Opening: ${recipe.opening.idea.slice(0, 40)}`);
  });
  it("reads the hook sticker, the setting and the stressed words, and drops what does not fit", () => {
    const clips = beats.map((_, i) => ({ index: i, frame: longFrame, motion, line: "Grow fresh greens at home today", stress: i === 0 ? ["fresh greens", "nowhere"] : [] }));
    const plan = readReel({ title: "T", caption: "C", hashtags: [], music: "afro", hook: "No land? No problem.", setting: "a home greenhouse in Kigali", clips }, input)!;
    expect(plan.hook).toBe("No land? No problem.");
    expect(plan.setting).toBe("a home greenhouse in Kigali");
    expect(plan.clips[0].stress).toEqual(["fresh greens"]);
    expect(readReel({ title: "T", caption: "C", hashtags: [], music: "afro", hook: "Only 250,000 RWF today for you all", clips }, input)!.hook).toBeNull();
  });
});
