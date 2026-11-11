// End to end, with mocks only at the edges (database in memory, the image engine, storage, music): Create saves the
// day's set -> the server draws its pictures (set-worker -> renderImageStep) -> the reel's video plan is made only once
// the pictures are ready, from those pictures, with the writer's voice-over script and a library song -> the render
// worker's queue picks it up -> the posts take the pictures and the reel -> the loading screen's progress reaches
// Ready. No AI is called and nothing is spent.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string; createdAt: Date };
type Where = Record<string, unknown>;

const h = vi.hoisted(() => {
  const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
  /** A small Prisma `where` matcher: equality, null, in / notIn / not / lt / gte / has, OR / AND. */
  const matches = (row: Record<string, unknown>, where: Where | undefined): boolean =>
    Object.entries(where ?? {}).every(([key, cond]) => {
      if (cond === undefined) return true;
      if (key === "OR") return (cond as Where[]).some((c) => matches(row, c));
      if (key === "AND") return (cond as Where[]).every((c) => matches(row, c));
      const value = row[key];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
        const c = cond as Record<string, unknown>;
        if ("in" in c && !(c.in as unknown[]).some((x) => same(x, value))) return false;
        if ("notIn" in c && (c.notIn as unknown[]).some((x) => same(x, value))) return false;
        if ("not" in c && (c.not === null ? value == null : same(value, c.not))) return false;
        if ("lt" in c && !(value != null && (value as number) < (c.lt as number))) return false;
        if ("gte" in c && !(value != null && (value as number) >= (c.gte as number))) return false;
        if ("has" in c && !(Array.isArray(value) && value.includes(c.has))) return false;
        return true;
      }
      return cond === null ? value == null : same(value, cond);
    });
  let clock = Date.parse("2026-11-11T08:00:00Z");
  const tick = () => new Date((clock += 1000));
  const table = (defaults: () => Record<string, unknown> = () => ({})) => {
    const rows: Row[] = [];
    let n = 0;
    const sorted = (list: Row[], orderBy?: { createdAt?: "asc" | "desc" }) => (orderBy?.createdAt ? [...list].sort((a, b) => (orderBy.createdAt === "asc" ? 1 : -1) * (a.createdAt.getTime() - b.createdAt.getTime())) : list);
    const apply = (row: Row, data: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && "increment" in (v as object)) row[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment;
        else row[k] = structuredClone(v);
      }
    };
    return {
      rows,
      findFirst: vi.fn(async ({ where, orderBy }: { where?: Where; orderBy?: { createdAt?: "asc" | "desc" } } = {}) => structuredClone(sorted(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null)),
      findUnique: vi.fn(async ({ where }: { where: Where }) => structuredClone(rows.find((r) => matches(r, where)) ?? null)),
      findMany: vi.fn(async ({ where, orderBy, take }: { where?: Where; orderBy?: { createdAt?: "asc" | "desc" }; take?: number } = {}) => structuredClone(sorted(rows.filter((r) => matches(r, where)), orderBy).slice(0, take ?? Infinity))),
      count: vi.fn(async ({ where }: { where?: Where } = {}) => rows.filter((r) => matches(r, where)).length),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `${String(data.kind ?? "row")}-${++n}`, createdAt: tick(), ...defaults() } as Row;
        apply(row, data);
        rows.push(row);
        return structuredClone(row);
      }),
      update: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        const row = rows.find((r) => matches(r, where));
        if (!row) throw new Error("not found");
        apply(row, data);
        return structuredClone(row);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) apply(r, data);
        return { count: hit.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Where }) => {
        const keep = rows.filter((r) => !matches(r, where));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return { count };
      }),
    };
  };
  const prisma = {
    contentVisual: table(() => ({ contentId: null, error: null, renderingUntil: null, renderedAt: null, robotAttempts: 0, robotJobId: null, clipState: null, business: { userId: "u1" } })),
    imageConcept: table(),
    post: table(),
    generatedContent: table(),
    business: table(),
  };
  return { prisma, tick, matches, after: vi.fn(), concepts: 0 };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("next/server", () => ({ after: h.after }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: vi.fn(async () => ({})), cancelJob: vi.fn(async () => undefined), registerJobHandler: vi.fn() }));
vi.mock("@/lib/entitlements", () => ({ hasFeature: vi.fn(async () => true), featureStatus: vi.fn(async () => "ok") }));
vi.mock("@/lib/usage", () => {
  class UsageLimitError extends Error {}
  return {
    consumeUsage: vi.fn(async () => ({ periodStart: new Date("2026-11-01") })),
    refundUsage: vi.fn(async () => undefined),
    consumeDailyVideo: vi.fn(),
    getUsageSummary: vi.fn(async () => ({ used: { image: 0 }, limits: { image: 50 }, resetsAt: null })),
    UsageLimitError,
  };
});
vi.mock("@/lib/ai/budget", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/budget")>()), companySpendThisMonth: vi.fn(async () => 0), companyCallAllowed: () => true }));
// The image engine (Gemini): a picture is planned, painted, then done, one step per call. Never called for real.
vi.mock("@/lib/image-engine/engine", () => {
  class EngineError extends Error {}
  return {
    EngineError,
    paintOne: vi.fn(),
    startPicture: vi.fn(async () => {
      const id = `concept-${++h.concepts}`;
      await h.prisma.imageConcept.create({ data: { id, businessId: "b1", status: "planned" } });
      return { id };
    }),
    stepPicture: vi.fn(async (_owner: unknown, id: string) => {
      const c = h.prisma.imageConcept.rows.find((r) => r.id === id)!;
      if (c.status === "planned") {
        c.status = "painted";
        return { status: "working" };
      }
      c.status = "done";
      return { status: "done", id, path: `u1/designs/${id}.png`, designId: `design-${id}` };
    }),
  };
});
vi.mock("@/lib/designs/service", () => {
  class DesignError extends Error {}
  return { DesignError, createPhotoDesign: vi.fn(async ({ photoPath }: { photoPath: string }) => ({ id: "design-photo", path: `u1/designs/photo-of-${photoPath.split("/").pop()}` })), createAiDesign: vi.fn(), createTemplateDesign: vi.fn() };
});
vi.mock("@/lib/music/service", () => ({ trackForVideo: vi.fn(async () => ({ trackId: "t1", title: "Kigali Sunrise", path: "music/kigali-sunrise.mp3", attribution: null, owned: true })), activeTracks: vi.fn(async () => []) }));
vi.mock("@/lib/content-board/auto", () => ({ retryAutoSchedule: vi.fn(async () => undefined), autoSchedule: vi.fn(async () => ({ scheduled: 0, waiting: 0 })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ remove: vi.fn(), info: vi.fn(), download: vi.fn() }) } }) }));
vi.mock("@/lib/media/service", () => {
  class MediaError extends Error {}
  return { MediaError, mediaUsage: vi.fn(), assertPlatformRoom: vi.fn() };
});
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: vi.fn() }));

import { fromSetProgress } from "@/components/visuals/making-progress";
import { reelDraftOf } from "@/lib/content-flow/service";
import { startSets } from "@/lib/content-flow/set-worker";
import { robotWaitingWhere } from "@/lib/visuals/robot";
import { setProgress } from "@/lib/visuals/progress";
import { attachToGroup } from "@/lib/visuals/service";
import type { ImagePlan, VideoPlan } from "@/lib/visuals/types";
import { spokenLines } from "@/lib/voice/speech";

const GROUP = "set-group-0001";
const visuals = () => h.prisma.contentVisual.rows;
const reelRow = () => visuals().find((v) => v.kind === "video");
const progress = async () => (await setProgress("b1", [GROUP], new Date("2026-11-11T09:00:00Z")))[0];

/** What Create (runDayContent -> planDaySets, tests/content-flow/service.test.ts) saves for the day: the posts and the set. */
async function createTheDay() {
  await h.prisma.business.create({ data: { id: "b1", userId: "u1", name: "Green Kigali", brandColors: ["#0a7f5a"], tone: "friendly", industry: null } });
  await h.prisma.generatedContent.create({ data: { id: "content-fb", businessId: "b1", brief: null, caption: "Fresh greens at school.", language: "English", productId: "p1", campaignId: null } });
  const post = (network: string, format: string, contentId: string) =>
    h.prisma.post.create({ data: { businessId: "b1", groupId: GROUP, contentId, network, format, status: "PENDING_APPROVAL", source: "STUDIO", mediaPaths: [], text: `${network} caption`, lockedAt: null, ownerEditedAt: null, lastError: null, updatedAt: new Date("2026-11-11T08:00:00Z"), productId: "p1" } });
  await post("facebook", "POST", "content-fb");
  await post("linkedin", "POST", "content-fb");
  await post("instagram", "SCRIPT", "content-fb");
  // The writer's set: two AI pictures and one of the owner's photos, and the reel's scenes with their spoken lines.
  const words = (t: string) => t;
  const reel = reelDraftOf(
    "slideshow",
    { scenes: [{ onScreen: "Greens at school", voice: "Imagine fresh greens grown right in class." }, { onScreen: "40 plants, one tower", voice: "One tower grows forty plants." }, { onScreen: "Ask us today", voice: "Ask us about it today." }], cta: "Message us" },
    { script: "", headline: "Greens at school", title: "Hydro tower", words, language: "English", mood: "upbeat" },
  );
  const slide = (headline: string, source: "ai" | "album", photoPath: string) => ({ template: "announcement" as const, headline, subline: "", chip: "", source, photoPath, scene: `${headline} idea`, designId: null, path: null });
  const plan: ImagePlan = {
    version: 1,
    pack: "fresh",
    aspectRatio: "4:5",
    slides: [slide("Greens at school", "ai", "u1/gallery/a.jpg"), slide("40 plants, one tower", "ai", "u1/gallery/b.jpg"), slide("Ask us today", "album", "u1/gallery/c.jpg")],
    directedBy: "ai",
    notes: [],
    language: "English",
    daySet: { groupId: GROUP, maxAi: 2, reel },
  };
  await h.prisma.contentVisual.create({ data: { businessId: "b1", groupId: GROUP, kind: "carousel", status: "pending", plan, items: [] } });
  return { reel };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const t of Object.values(h.prisma)) t.rows.splice(0);
  h.concepts = 0;
});

describe("one shared set per day, end to end", () => {
  it("Create -> pictures drawn on the server -> reel planned from them -> rendered with voice and music -> Ready", async () => {
    const { reel } = await createTheDay();
    // Right after Create the screen shows the pictures being designed; there is no reel yet.
    expect(await progress()).toMatchObject({ step: "images", ready: false, reel: { status: "waiting" } });
    expect(fromSetProgress([await progress()])).toMatchObject({ step: "images", reel: true, music: true });

    // Create starts the drawing after its answer (Next's after()); run it a step at a time like the job loop does.
    await startSets("b1", [GROUP]);
    expect(h.after).toHaveBeenCalledTimes(1);
    const { drawSet } = await import("@/lib/content-flow/set-worker");
    const fractions: number[] = [];
    let outcome = "pending";
    for (let i = 0; i < 6 && outcome !== "ready"; i++) {
      outcome = await drawSet("b1", GROUP, { maxSteps: 1 });
      const p = await progress();
      if (outcome !== "ready") {
        // The reel's plan waits for the pictures: never made while any is still being drawn.
        expect(reelRow()).toBeUndefined();
        expect(p.step).toBe("images");
        fractions.push(fromSetProgress([p])!.fraction ?? 0);
      }
    }
    expect(outcome).toBe("ready");
    // The real fraction only goes up while the pictures are made.
    expect(fractions.length).toBeGreaterThan(1);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);

    // The pictures: two AI pictures from the engine and the owner's photo, in order.
    const picture = visuals().find((v) => v.kind !== "video")!;
    expect(picture.status).toBe("ready");
    const paths = (picture.items as { path: string }[]).map((i) => i.path);
    expect(paths).toEqual(["u1/designs/concept-1.png", "u1/designs/concept-2.png", "u1/designs/photo-of-c.jpg"]);

    // The reel was planned once they were ready, from those very pictures, with the writer's spoken lines and a song.
    const reelVisual = reelRow()!;
    expect(reelVisual.createdAt.getTime()).toBeGreaterThan(picture.createdAt.getTime());
    expect((picture.plan as ImagePlan).daySet?.reelVisualId).toBe(reelVisual.id);
    const video = reelVisual.plan as VideoPlan;
    expect(video.daySetId).toBe(GROUP);
    expect(new Set(video.scenes.map((s) => s.photoPath))).toEqual(new Set(paths));
    expect(video.music).toMatchObject({ title: "Kigali Sunrise" });
    expect(video.voiceScript).toHaveLength(video.scenes.length);
    // The voice-over speaks the script, not the words on screen.
    const spoken = spokenLines(video);
    expect(spoken).toEqual(video.voiceScript);
    for (const line of reel.scenes.map((s) => s.voice)) expect(spoken).toContain(line.endsWith(".") ? line : `${line}.`);

    // The posts got the pictures already (Facebook and LinkedIn the 3 pictures); Instagram waits for its reel.
    const byNetwork = () => Object.fromEntries(h.prisma.post.rows.map((p) => [p.network, p.mediaPaths as string[]]));
    expect(byNetwork().facebook).toEqual(paths);
    expect(byNetwork().linkedin).toEqual(paths);
    expect(byNetwork().instagram).toEqual([]);

    // The screen: the reel is next; the render worker's queue (the PC worker, the video robot) holds it.
    expect(await progress()).toMatchObject({ step: "reel", reel: { status: "pending", music: "Kigali Sunrise" } });
    expect(h.matches(reelVisual, robotWaitingWhere(new Date("2026-11-11T09:00:00Z")) as Where)).toBe(true);

    // The worker renders it (voice and music mixed in) and the file is saved: the posts take the reel, and Ready.
    await h.prisma.contentVisual.update({ where: { id: reelVisual.id }, data: { renderingUntil: new Date("2026-11-11T09:05:00Z") } });
    expect(await progress()).toMatchObject({ step: "music", reel: { status: "rendering" } });
    await h.prisma.contentVisual.update({ where: { id: reelVisual.id }, data: { status: "ready", renderingUntil: null, items: [{ path: "u1/videos/reel.mp4" }] } });
    await attachToGroup("b1", GROUP);
    expect(byNetwork().instagram).toEqual(["u1/videos/reel.mp4"]);
    const done = await progress();
    expect(done).toMatchObject({ step: "ready", ready: true, percent: 100, reel: { status: "ready", path: "u1/videos/reel.mp4" } });
    expect(fromSetProgress([done])).toMatchObject({ step: "ready", failed: null });
  });
});
