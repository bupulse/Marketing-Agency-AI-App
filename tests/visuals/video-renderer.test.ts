import { describe, expect, it } from "vitest";
import { drawFrame, renderVideo, videoSupport, VideoRenderError } from "@/components/visuals/video-renderer";
import { kenBurns, sceneStarts } from "@/lib/visuals/timeline";
import type { VideoPlan } from "@/lib/visuals/types";

const plan: VideoPlan = {
  version: 1,
  width: 1080,
  height: 1920,
  fps: 30,
  pack: "clean",
  colors: { background: "#101820", text: "#ffffff", accent: "#ff6a00" },
  businessName: "Nova Shop",
  scenes: [
    { text: "New arrivals are here", photoPath: "a.jpg", durationMs: 3000, motion: "zoom-in", role: "hook" },
    { text: "Come see us this week", photoPath: null, durationMs: 3000, motion: "pan-left", role: "cta" },
  ],
  crossfadeMs: 500,
  totalMs: 5500,
};

type Call = { name: string; args: unknown[] };

/** A hand-written 2D context that records the calls the renderer makes. */
function fakeContext() {
  const calls: Call[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
  };
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    fillRect: record("fillRect"),
    drawImage: record("drawImage"),
    fillText: record("fillText"),
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    arc: record("arc"),
    fill: record("fill"),
    measureText: (s: string) => ({ width: s.length * 30 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const image = { width: 2000, height: 3000 } as unknown as HTMLImageElement;

describe("video renderer", () => {
  it("reports no support without the browser globals", () => {
    expect(videoSupport()).toEqual({ mp4: false, webm: false });
  });

  it("rejects as unsupported when neither encoder exists", async () => {
    const error = await renderVideo(plan, { photoUrls: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VideoRenderError);
    expect((error as VideoRenderError).reason).toBe("unsupported");
  });

  it("draws the first scene's photo, scrim and caption at t=0", () => {
    const { ctx, calls } = fakeContext();
    drawFrame(ctx, plan, new Map([["a.jpg", image]]), 0);
    expect(calls[0]).toEqual({ name: "fillRect", args: [0, 0, 1080, 1920] });
    const draws = calls.filter((c) => c.name === "drawImage");
    expect(draws).toHaveLength(1);
    const r = kenBurns("zoom-in", 0, image, { width: 1080, height: 1920 });
    expect(draws[0].args).toEqual([image, r.sx, r.sy, r.sw, r.sh, 0, 0, 1080, 1920]);
    // Caption opacity is 0 at progress 0, so only the business name is written.
    expect(calls.filter((c) => c.name === "fillText").map((c) => c.args[0])).toEqual(["Nova Shop"]);
  });

  it("cross-fades both photos but writes no caption mid-crossfade; the next caption follows alone", () => {
    const { ctx, calls } = fakeContext();
    const t = sceneStarts(plan)[1] + 250;
    drawFrame(ctx, plan, new Map([["a.jpg", image]]), t);
    // Scene 1 photo underneath, scene 2 backdrop (no photo) on top.
    expect(calls.filter((c) => c.name === "drawImage")).toHaveLength(1);
    expect(calls.filter((c) => c.name === "arc")).toHaveLength(1);
    expect(calls.filter((c) => c.name === "fillText").map((c) => c.args[0])).toEqual(["Nova Shop"]);

    const after = fakeContext();
    drawFrame(after.ctx, plan, new Map([["a.jpg", image]]), sceneStarts(plan)[1] + plan.crossfadeMs + 400);
    const texts = after.calls.filter((c) => c.name === "fillText").map((c) => c.args[0] as string);
    expect(texts).toContain("Come see us this week");
    expect(texts).not.toContain("New arrivals are here");
    expect(texts.at(-1)).toBe("Nova Shop");
  });
});
