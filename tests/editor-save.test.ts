import { describe, expect, it } from "vitest";
import { describeEdit } from "@/lib/editor/describe";
import { mp4Name } from "@/components/editor/reel-spec";
import { trimShot } from "@/lib/editor/ops";
import { exampleInputProblem, exampleInputSchema, fileProblem } from "@/lib/training-lab/types";
import type { MotionSpec } from "@/lib/video-engine/spec";

// The payload the editor's "Save as a Lab example" sends (components/editor/save-panel.tsx) is accepted by the Library's checks.
const spec = (): MotionSpec => ({
  version: 1, title: "Reel", ratio: "9:16", fps: 30, palette: { background: "#000", primary: "#f00", accent: "#f00", text: "#fff" },
  scenes: [{ seconds: 4, background: { kind: "solid", colors: ["#000"] }, layers: [{ kind: "video", url: "a.mp4", fit: "cover", start: 0, x: 0.5, y: 0.5, w: 1, h: 1 }] }, { seconds: 4, background: { kind: "solid", colors: ["#000"] }, layers: [{ kind: "video", url: "a.mp4", fit: "cover", start: 4, x: 0.5, y: 0.5, w: 1, h: 1 }] }],
  music: null, caption: "", hashtags: [],
});

describe("the saved edit", () => {
  const changes = describeEdit(spec(), trimShot(spec(), 0, { seconds: 2.5 }));
  const input = { kind: "reel", title: "Edit of Kigali tower", howMade: `Edited in the Training Lab from reel Kigali tower: ${changes.join(" ")}`, whatIsGood: "The hook lands sooner.", neverThis: "", language: "Kinyarwanda", tags: ["edited reel"], engines: ["reel", "video"], notes: { edit: changes, from_reel: "job1" }, hasFile: true };
  it("passes the Library's checks and keeps the notes", () => {
    expect(exampleInputProblem(input)).toBeNull();
    const v = exampleInputSchema.parse(input);
    expect(v).toMatchObject({ kind: "reel", engines: ["reel", "video"], neverThis: null, notes: { edit: changes, from_reel: "job1" } });
    expect(v.howMade).toContain("Shot 1 was trimmed from 4 s to 2.5 s.");
  });
  it("asks for why, as the Library does", () => {
    expect(exampleInputProblem({ ...input, whatIsGood: "" })).toBe("Say what is good about it.");
  });
  it("sends an MP4 the Library accepts", () => {
    expect(fileProblem({ name: mp4Name("Edit of Kigali tower"), type: "video/mp4", size: 8_000_000 }, "reel")).toBeNull();
  });
});
