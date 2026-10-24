import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), reelView: vi.fn(), reelContact: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { reelJob: { findMany: m.findMany, findFirst: m.findFirst } } }));
vi.mock("@/lib/reel-engine/engine", () => ({ reelView: m.reelView, reelContact: m.reelContact }));

import { mp4Name, planFromView } from "@/components/editor/reel-spec";
import { REELS_MAX, listFinishedReels, openFinishedReel } from "@/app/admin/(console)/(ai)/training-lab/editor/reels";
import { buildReelSpec } from "@/lib/reel-engine/story";
import type { ReelView } from "@/lib/reel-engine/engine";

const view = (over: Partial<ReelView> = {}): ReelView => ({
  id: "j1", status: "done", language: "English", tier: "lite", title: "Kigali tower", caption: "c", hashtags: ["a"], costUsd: 1, error: null, presenter: "a woman", price: "45,000 RWF", hook: "Grow indoors", setting: null, refilms: 0, tag: "LEAF",
  clips: ["hook", "use", "result", "cta"].map((beat) => ({ beat, kind: "talk" as const, seconds: 8, label: beat, line: `Line for ${beat} here`, stress: [], status: "done", problems: [], frameUrl: null, clipUrl: `https://clips/${beat}.mp4` })),
  musicUrl: null, reelUrl: null, ...over,
});

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
});

describe("planFromView", () => {
  it("carries what the spec builders read", () => {
    const plan = planFromView(view());
    expect(plan).toMatchObject({ title: "Kigali tower", price: "45,000 RWF", hook: "Grow indoors", tag: "LEAF", music: null });
    expect(plan.clips.map((c) => c.beat)).toEqual(["hook", "use", "result", "cta"]);
    expect(plan.clips[0]).toMatchObject({ kind: "talk", seconds: 8, line: "Line for hook here", status: "done" });
  });
  it("builds a spec with the clips' links, the brand's end card and the cuts", () => {
    const v = view();
    const spec = buildReelSpec(planFromView(v), v.clips.map((c) => c.clipUrl ?? ""), { name: "LEAF", color: "#1B5E20", contact: "WhatsApp 0788 000 000" });
    const clipUrls = new Set(spec.scenes.flatMap((s) => s.layers.flatMap((l) => (l.kind === "video" ? [l.url] : []))));
    expect([...clipUrls].sort()).toEqual(v.clips.map((c) => c.clipUrl).sort());
    expect(spec.scenes.length).toBeGreaterThan(4);
    expect(spec.scenes.flatMap((s) => s.layers).some((l) => l.kind === "text" && l.text === "LEAF")).toBe(true);
  });
  it("makes a montage spec for a reel with product shots", () => {
    const v = view({ clips: [...view().clips.slice(0, 2), { ...view().clips[0], kind: "broll", beat: "broll", seconds: 4 }, ...view().clips.slice(2)] });
    const spec = buildReelSpec(planFromView(v), v.clips.map((c) => c.clipUrl ?? ""), { name: "LEAF", color: "#1B5E20", contact: null });
    expect(spec.scenes.length).toBeGreaterThan(4);
  });
});

describe("mp4Name", () => {
  it("makes a safe file name from the title", () => {
    expect(mp4Name("Kigali car seller!")).toBe("kigali-car-seller.mp4");
    expect(mp4Name("  Ikanzu nziza / 45,000 RWF  ")).toBe("ikanzu-nziza-45-000-rwf.mp4");
    expect(mp4Name("???")).toBe("video.mp4");
    expect(mp4Name("x".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe("the reel list and opening", () => {
  it("lists the newest finished reels with the business and the title", async () => {
    m.findMany.mockResolvedValue([{ id: "j1", plan: { title: " Kigali tower " }, createdAt: new Date("2026-10-24T10:00:00Z"), business: { name: "LEAF" } }, { id: "j2", plan: {}, createdAt: new Date("2026-10-23T10:00:00Z"), business: { name: "Nova" } }]);
    const out = await listFinishedReels();
    expect(m.findMany.mock.calls[0][0]).toMatchObject({ where: { status: "done" }, orderBy: { createdAt: "desc" }, take: REELS_MAX });
    expect(REELS_MAX).toBe(20);
    expect(out).toEqual([
      { id: "j1", business: "LEAF", title: "Kigali tower", createdAt: "2026-10-24T10:00:00.000Z" },
      { id: "j2", business: "Nova", title: "Untitled reel", createdAt: "2026-10-23T10:00:00.000Z" },
    ]);
  });
  it("opens a finished reel through the Videos page's own server code, with the brand", async () => {
    m.findFirst.mockResolvedValue({ id: "j1", businessId: "b1", business: { userId: "u1", name: "LEAF", brandColors: ["blue", "#0A7B3E"] } });
    m.reelView.mockResolvedValue(view());
    m.reelContact.mockResolvedValue("WhatsApp 0788 000 000");
    const out = await openFinishedReel("j1");
    expect(m.findFirst.mock.calls[0][0].where).toEqual({ id: "j1", status: "done" });
    expect(m.reelView).toHaveBeenCalledWith({ userId: "u1", businessId: "b1" }, "j1");
    expect(out?.brand).toEqual({ name: "LEAF", color: "#0A7B3E", contact: "WhatsApp 0788 000 000" });
    expect(out?.view.title).toBe("Kigali tower");
  });
  it("uses the BuPulse green when no brand colour is valid, and returns null for a reel that is gone", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "j1", businessId: "b1", business: { userId: "u1", name: "X", brandColors: [] } });
    m.reelView.mockResolvedValue(view());
    m.reelContact.mockResolvedValue(null);
    expect((await openFinishedReel("j1"))?.brand.color).toBe("#1B5E20");
    m.findFirst.mockResolvedValueOnce(null);
    expect(await openFinishedReel("nope")).toBeNull();
    expect(await openFinishedReel("")).toBeNull();
    m.findFirst.mockResolvedValueOnce({ id: "j1", businessId: "b1", business: { userId: "u1", name: "X", brandColors: [] } });
    m.reelView.mockResolvedValueOnce(null);
    expect(await openFinishedReel("j1")).toBeNull();
  });
});
