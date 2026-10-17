// Premium 3D (docs/BLENDER.md): the scene checks, the Blender command line and the job runner, with Blender mocked.
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLENDER_CAMERA_MOVES,
  BLENDER_MATERIALS,
  BLENDER_SCENE_FORMAT,
  blenderCanvasSize,
  blenderCommand,
  normalizeBlenderScene,
  parseBlenderProgress,
} from "@/tools/blender/scene";

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: (signal?: string) => void };
type Behaviour = (args: string[], child: FakeChild) => void;
const behaviour: { render: Behaviour } = { render: () => {} };
const calls: string[][] = [];

vi.mock("node:child_process", () => ({
  spawn: (_bin: string, args: string[]) => {
    calls.push(args);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => setTimeout(() => child.emit("close", null), 0) }) as FakeChild;
    setTimeout(() => {
      if (args[0] === "--version") {
        child.stdout.emit("data", Buffer.from("Blender 5.2.2 LTS\n"));
        child.emit("close", 0);
      } else behaviour.render(args, child);
    }, 0);
    return child;
  },
}));

const { blenderAvailable, renderBlenderScene, resetBlenderAvailable } = await import("@/video-lab/blender-jobs");

describe("normalizeBlenderScene", () => {
  it("fills every default for an empty scene", () => {
    const { scene, warnings } = normalizeBlenderScene({});
    expect(scene.canvas).toEqual({ ratio: "9:16", quality: "540p", fps: 24, samples: 16 });
    expect(scene.duration).toBe(4);
    expect(scene.background.kind).toBe("studio");
    expect(scene.background.colors).toHaveLength(2);
    expect(scene.camera.move).toBe("orbitRight");
    expect(scene.camera.fstop).toBe(0);
    expect(scene.product).toBeNull();
    expect(scene.texts).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("clamps numbers, drops bad colours and replaces unknown choices", () => {
    const { scene, warnings } = normalizeBlenderScene({
      duration: 90,
      canvas: { ratio: "2:1", quality: "4k", fps: 60, samples: 9999 },
      background: { kind: "space", colors: ["red", "#ABCDEF"], floor: { reflect: 7 } },
      camera: { move: "handheld", intensity: -1, lens: 500 },
      texts: [{ text: "SALE", size: 99, material: "gold", color: "javascript:alert(1)" }, { text: "   " }],
    });
    expect(scene.duration).toBe(15);
    expect(scene.canvas).toEqual({ ratio: "9:16", quality: "540p", fps: 24, samples: 128 });
    expect(scene.background.kind).toBe("studio");
    expect(scene.background.colors).toEqual(["#abcdef", "#abcdef"]);
    expect(scene.background.floor.reflect).toBe(1);
    expect(scene.camera).toMatchObject({ move: "orbitRight", intensity: 0, lens: 135 });
    expect(scene.texts).toHaveLength(1);
    expect(scene.texts[0]).toMatchObject({ text: "SALE", size: 3, material: "metal", color: "#ffffff", enter: "spinIn" });
    expect(warnings.join(" ")).toMatch(/Duration set to 15/);
    expect(warnings.join(" ")).toMatch(/handheld/);
  });

  it("takes the product from the photo list, with its cutout", () => {
    const photos = [{ image: "/data/a.jpg" }, { image: "/data/b.jpg", cutout: "/data/b-cut.png" }];
    const { scene } = normalizeBlenderScene({ product: { photo: 2, idle: "turntable" } }, { photos });
    expect(scene.product).toMatchObject({ image: "/data/b.jpg", cutout: "/data/b-cut.png", idle: "turntable", enter: "rise", shape: "card" });
  });

  it("refuses raw paths from Claude and a photo that does not exist", () => {
    const fromClaude = normalizeBlenderScene({ product: { image: "/etc/passwd" } }, { photos: [{ image: "/data/a.jpg" }] });
    expect(fromClaude.scene.product).toBeNull();
    expect(fromClaude.warnings.join(" ")).toMatch(/not allowed/);
    const missing = normalizeBlenderScene({ product: { photo: 3 } }, { photos: [{ image: "/data/a.jpg" }] });
    expect(missing.scene.product).toBeNull();
    expect(missing.warnings.join(" ")).toMatch(/does not exist/);
    const byHand = normalizeBlenderScene({ product: { image: "video-lab/data/photos/x.jpg" } }, { allowPaths: true });
    expect(byHand.scene.product?.image).toBe("video-lab/data/photos/x.jpg");
  });

  it("keeps the limits on texts, props, particles and entrance times", () => {
    const { scene, warnings } = normalizeBlenderScene({
      duration: 3,
      texts: Array.from({ length: 9 }, (_, i) => ({ text: `T${i}`, enterAt: 5 })),
      props: Array.from({ length: 20 }, () => ({ kind: "sphere" })),
      particles: Array.from({ length: 5 }, () => ({ kind: "confetti", count: 1000, colors: ["#fff", "#000", "#f00", "#0f0", "#00f", "#ff0"] })),
    });
    expect(scene.texts).toHaveLength(6);
    expect(scene.texts.every((t) => t.enterAt === 0)).toBe(true);
    expect(scene.props).toHaveLength(12);
    expect(scene.particles).toHaveLength(3);
    expect(scene.particles[0].count).toBe(150);
    expect(scene.particles[0].colors).toHaveLength(5);
    expect(warnings.join(" ")).toMatch(/Only 6 texts/);
    expect(warnings.join(" ")).toMatch(/after the end of the clip/);
  });

  it("accepts the three example scenes without a single repair", async () => {
    const dir = path.resolve("tools/blender/scenes");
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const raw = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
      const { warnings } = normalizeBlenderScene(raw, { allowPaths: true });
      expect(warnings, f).toEqual([]);
    }
  });
});

describe("Blender helpers", () => {
  it("sizes the canvas with even numbers", () => {
    expect(blenderCanvasSize({ ratio: "9:16", quality: "540p", fps: 24, samples: 16 })).toEqual({ width: 540, height: 960 });
    expect(blenderCanvasSize({ ratio: "9:16", quality: "720p", fps: 24, samples: 16 })).toEqual({ width: 720, height: 1280 });
    expect(blenderCanvasSize({ ratio: "16:9", quality: "1080p", fps: 24, samples: 16 })).toEqual({ width: 1920, height: 1080 });
    expect(blenderCanvasSize({ ratio: "4:5", quality: "480p", fps: 24, samples: 16 })).toEqual({ width: 480, height: 600 });
  });

  it("builds the headless command", () => {
    const { bin, args } = blenderCommand({ scenePath: "/t/s.json", outPath: "/t/o.mp4", repoDir: "/repo", stills: [0.1, 1.5], stillsDir: "/t/st", preview: true });
    expect(bin).toBe("/Applications/Blender.app/Contents/MacOS/Blender");
    expect(args.slice(0, 5)).toEqual(["-b", "--factory-startup", "-noaudio", "-P", "/repo/tools/blender/render.py"]);
    expect(args).toContain("--");
    expect(args.join(" ")).toContain("--scene /t/s.json --out /t/o.mp4 --base-dir /repo --stills 0.100,1.000 --stills-dir /t/st --preview");
  });

  it("reads progress lines", () => {
    expect(parseBlenderProgress("BLENDER_PROGRESS 12 48")).toBe(0.25);
    expect(parseBlenderProgress("Fra:12 Mem:20M")).toBeNull();
    expect(parseBlenderProgress("BLENDER_PROGRESS 3 0")).toBeNull();
  });

  it("describes every camera move and material to Claude", () => {
    for (const m of [...BLENDER_CAMERA_MOVES, ...BLENDER_MATERIALS]) expect(BLENDER_SCENE_FORMAT).toContain(`"${m}"`);
  });
});

describe("renderBlenderScene (Blender mocked)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "blender-test-"));
    const bin = path.join(dir, "Blender");
    await fs.writeFile(bin, "#!/bin/sh\n");
    await fs.chmod(bin, 0o755);
    process.env.BLENDER_BIN = bin;
  });
  afterAll(async () => {
    delete process.env.BLENDER_BIN;
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    calls.length = 0;
    resetBlenderAvailable();
  });

  it("knows Blender is there", async () => {
    expect(await blenderAvailable()).toBe(true);
  });

  it("says so when Blender is missing", async () => {
    process.env.BLENDER_BIN = path.join(dir, "nope");
    expect(await blenderAvailable()).toBe(false);
    await expect(renderBlenderScene({}, path.join(dir, "a.mp4"))).rejects.toThrow(/not installed/);
    process.env.BLENDER_BIN = path.join(dir, "Blender");
  });

  it("renders, streams progress to the log and returns the MP4", async () => {
    behaviour.render = (args, child) => {
      const out = args[args.indexOf("--out") + 1];
      child.stdout.emit("data", Buffer.from("BLENDER_SCENE 540x960 96 frames\nBLENDER_PROGRESS 48 96\n"));
      child.stdout.emit("data", Buffer.from("BLENDER_PROGRESS 96 96\n"));
      void fs.writeFile(out, Buffer.alloc(2048)).then(() => child.emit("close", 0));
    };
    const progress: number[] = [];
    const out = path.join(dir, "clip.mp4");
    const res = await renderBlenderScene({ duration: 4, product: { photo: 1 } }, out, { photos: [{ image: "/x/a.jpg" }], onProgress: (p) => progress.push(p) });
    expect(res).toMatchObject({ path: out, bytes: 2048 });
    expect(res.seconds).toBeGreaterThanOrEqual(0);
    expect(progress).toEqual([0.5, 1]);
    expect(await fs.readFile(res.log, "utf8")).toContain("BLENDER_PROGRESS 96 96");
    const written = JSON.parse(await fs.readFile(path.join(dir, "clip.scene.json"), "utf8"));
    expect(written.product.image).toBe("/x/a.jpg");
    const renderArgs = calls.find((a) => a.includes("--scene"))!;
    expect(renderArgs[renderArgs.indexOf("--scene") + 1]).toBe(path.join(dir, "clip.scene.json"));
  });

  it("reports Blender's error in plain English", async () => {
    behaviour.render = (_args, child) => {
      child.stderr.emit("data", Buffer.from("BLENDER_ERROR image not found: a.jpg\n"));
      child.emit("close", 1);
    };
    await expect(renderBlenderScene({}, path.join(dir, "bad.mp4"))).rejects.toThrow(/The 3D render failed: image not found: a.jpg/);
  });

  it("stops a render that runs too long", async () => {
    behaviour.render = () => {};
    await expect(renderBlenderScene({}, path.join(dir, "slow.mp4"), { timeoutMs: 30 })).rejects.toThrow(/longer than/);
  });

  it("refuses a scene whose product photo is not in the photo list", async () => {
    behaviour.render = (_args, child) => child.emit("close", 0);
    await expect(renderBlenderScene({ product: { photo: 2 } }, path.join(dir, "nophoto.mp4"), { photos: [{ image: "/x/a.jpg" }] })).rejects.toThrow(/product photo is missing/);
  });

  it("fails when Blender wrote nothing", async () => {
    behaviour.render = (_args, child) => child.emit("close", 0);
    await expect(renderBlenderScene({}, path.join(dir, "empty.mp4"))).rejects.toThrow(/wrote no video/);
  });
});
