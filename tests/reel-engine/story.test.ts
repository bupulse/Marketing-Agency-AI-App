import { describe, expect, it } from "vitest";
import { buildReelSpec, directReel, reelCostUsd, SCENE_SECONDS, veoClipPrompt, type ReelPlan } from "@/lib/reel-engine/story";
import { totalMs } from "@/lib/video-engine/spec";
import { readReel, reelPrompt, ruleReel, type ReelInput } from "@/lib/reel-engine/writer";

const beats = directReel([], "job-1");
const input: ReelInput = {
  business: { name: "LEAF", industry: "Agriculture", description: "Vertical hydroponic towers", audience: "Farmers", place: "Kigali, Rwanda", language: "Kinyarwanda", voice: null, colors: [] },
  subject: { name: "LEAF Hydro Tower", description: "Grows 30 plants in one square metre", price: "250,000 RWF", sellingPoints: [] },
  brief: null,
  language: "Kinyarwanda",
  presenter: "a Black Rwandan woman in her early thirties",
  beats,
  recent: [],
};
const longFrame = "The presenter stands in a plastic-covered greenhouse outside Kigali holding a crate of lettuce next to the white LEAF tower, soft morning light through the dusty roof, crates and a hose on the wet floor.";
const motion = "She lifts the crate towards the camera and smiles as the camera slowly pushes in.";

describe("the reel's story", () => {
  it("is 4 beats in order, each a variant and camera the company had least, never the same camera twice", () => {
    expect(beats.map((b) => b.beat)).toEqual(["hook", "use", "result", "cta"]);
    expect(new Set(beats.map((b) => b.camera)).size).toBe(4);
    const next = directReel(beats.map(({ variant, camera }) => ({ variant, camera })), "job-2");
    expect(next.map((b) => b.variant)).not.toEqual(beats.map((b) => b.variant));
  });

  it("asks Veo for real footage with the line spoken in the reel's language and no words on screen", () => {
    const p = veoClipPrompt({ motion, line: "Muraho! Reba uko umusaruro wiyongera.", camera: "slow push-in on a gimbal", presenter: true }, "Kinyarwanda");
    expect(p).toContain('speaks to the camera in Kinyarwanda, clearly and warmly, lips in sync: "Muraho! Reba uko umusaruro wiyongera."');
    expect(p).toContain("No text, captions or subtitles on screen");
    expect(veoClipPrompt({ motion, line: "", camera: "static tripod", presenter: false }, "English")).toContain("Only natural sound of the place.");
  });

  it("joins 4 clips into exactly 30 seconds with their sound, a subtitle each and the brand on the last", () => {
    const plan: ReelPlan = { ...ruleReel(input), clips: ruleReel(input).clips.map((c, i) => ({ ...c, line: `Line ${i}` })) };
    const spec = buildReelSpec(plan, ["a.mp4", "b.mp4", "c.mp4", "d.mp4"], { name: "LEAF", color: "#1B5E20" });
    expect(totalMs(spec)).toBe(30_000);
    expect(spec.scenes.every((s) => s.seconds === SCENE_SECONDS)).toBe(true);
    expect(spec.scenes[0].layers[0]).toMatchObject({ kind: "video", url: "a.mp4", sound: true });
    expect(spec.scenes[0].layers[1]).toMatchObject({ kind: "text", text: "Line 0" });
    expect(spec.scenes[3].layers.some((l) => l.kind === "text" && l.text === "LEAF")).toBe(true);
    expect(reelCostUsd(0.8)).toBeCloseTo(3.49, 2);
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
