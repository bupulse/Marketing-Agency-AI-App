import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  project: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  generatedContent: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
}));
const service = vi.hoisted(() => ({ generateForProject: vi.fn() }));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {
    constructor(
      public reason: string,
      public metric: string,
    ) {
      super(reason);
    }
  }
  return { UsageLimitError };
});
const rateLimitMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const remove = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, rateLimit: rateLimitMock };
});
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: async () => ({ id: "u1" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  buildObjectPath: (u: string, n: string, f: string) => `${u}/${f}/x-${n}`,
  createSignedUploadUrl: async (_b: string, path: string) => ({ path, token: "tok" }),
  createSignedDownloadUrl: async (_b: string, path: string) => `https://signed/${path}`,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ storage: { from: () => ({ remove }) } }) }));
vi.mock("@/lib/studio/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/studio/service")>("@/lib/studio/service");
  return { ...actual, generateForProject: service.generateForProject };
});

import {
  createPhotoUpload,
  createProject,
  deleteProject,
  generateContent,
  getPhotoUrls,
  saveEditedContent,
  updateProject,
} from "@/app/dashboard/projects/actions";
import { StudioNotFoundError } from "@/lib/studio/service";

const fields = { type: "product", title: "Loaf", features: ["fresh"], photoPaths: [] as string[] };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.business.findUnique.mockResolvedValue({ id: "b1" });
  prisma.project.create.mockResolvedValue({ id: "p1" });
  prisma.project.count.mockResolvedValue(0);
  prisma.generatedContent.findMany.mockResolvedValue([]);
});

describe("authorisation", () => {
  it("treats another account's project as not found", async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    expect((await generateContent("other")).ok).toBe(false);
    expect((await updateProject("other", fields)).ok).toBe(false);
    expect((await deleteProject("other")).ok).toBe(false);
    expect((await getPhotoUrls("other")).ok).toBe(false);
    for (const call of prisma.project.findFirst.mock.calls) expect(call[0].where).toMatchObject({ businessId: "b1" });
    expect(service.generateForProject).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it("treats another account's content as not found", async () => {
    prisma.generatedContent.findFirst.mockResolvedValue(null);
    const result = await saveEditedContent("c-other", { caption: "x", hashtags: [], videoScript: "", adHeadlines: [] });
    expect(result.ok).toBe(false);
    expect(prisma.generatedContent.findFirst.mock.calls[0][0].where).toEqual({ id: "c-other", project: { businessId: "b1" } });
    expect(prisma.generatedContent.create).not.toHaveBeenCalled();
  });
});

describe("photos", () => {
  it("only signs uploads for images up to 10 MB under the user's projects folder", async () => {
    expect(await createPhotoUpload({ fileName: "a.png", type: "image/png", size: 100 })).toEqual({ ok: true, path: "u1/projects/x-a.png", token: "tok" });
    expect((await createPhotoUpload({ fileName: "a.mp4", type: "video/mp4", size: 100 })).ok).toBe(false);
    expect((await createPhotoUpload({ fileName: "a.png", type: "image/png", size: 11 * 1024 * 1024 })).ok).toBe(false);
  });

  it("rejects photo paths outside the user's folder, traversal, and more than 10", async () => {
    for (const photoPaths of [["u2/projects/a.png"], ["u1/projects/../u2/a.png"], Array.from({ length: 11 }, (_, i) => `u1/projects/${i}.png`)]) {
      const result = await createProject({ ...fields, photoPaths });
      expect(result.ok).toBe(false);
    }
    expect(prisma.project.create).not.toHaveBeenCalled();
  });
});

describe("createProject", () => {
  it("creates the project and returns the generated content id", async () => {
    service.generateForProject.mockResolvedValue({ id: "c1" });
    const result = await createProject({ ...fields, details: "notes", photoPaths: ["u1/projects/a.png"], generate: true });
    expect(result).toEqual({ ok: true, projectId: "p1", contentId: "c1" });
    expect(prisma.project.create.mock.calls[0][0].data).toMatchObject({ businessId: "b1", details: { notes: "notes" } });
    expect(service.generateForProject).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", businessId: "b1", projectId: "p1", feature: "content" }));
  });

  it("keeps the project and reports a usage block", async () => {
    service.generateForProject.mockRejectedValue(new usage.UsageLimitError("trial_expired", "text"));
    const result = await createProject({ ...fields, generate: true });
    expect(result).toMatchObject({ ok: false, blocked: "trial_expired", projectId: "p1" });
  });
});

describe("generateContent", () => {
  it("passes the instruction and uses regenerate once a version exists", async () => {
    prisma.project.findFirst.mockResolvedValue({ id: "p1", _count: { contents: 2 } });
    service.generateForProject.mockResolvedValue({ id: "c2" });
    expect(await generateContent("p1", { instruction: "  shorter " })).toEqual({ ok: true, contentId: "c2" });
    expect(service.generateForProject).toHaveBeenCalledWith(expect.objectContaining({ instruction: "shorter", feature: "regenerate" }));
  });

  it("maps a missing project and an AI failure to errors", async () => {
    prisma.project.findFirst.mockResolvedValue({ id: "p1", _count: { contents: 0 } });
    service.generateForProject.mockRejectedValue(new StudioNotFoundError());
    expect((await generateContent("p1")).ok).toBe(false);
  });
});

describe("saveEditedContent", () => {
  it("saves a new edited version without using a credit", async () => {
    prisma.generatedContent.findFirst.mockResolvedValue({ projectId: "p1", language: "French" });
    prisma.generatedContent.create.mockResolvedValue({ id: "c3" });
    const result = await saveEditedContent("c1", { caption: "Mon texte", hashtags: ["pain", "#bio"], videoScript: "s", adHeadlines: ["H"] });
    expect(result).toEqual({ ok: true, contentId: "c3" });
    expect(prisma.generatedContent.create.mock.calls[0][0].data).toMatchObject({
      projectId: "p1",
      language: "French",
      edited: true,
      provider: "edit",
      model: "owner",
      hashtags: ["#pain", "#bio"],
    });
    expect(service.generateForProject).not.toHaveBeenCalled();
  });
});

describe("limits", () => {
  it("answers a rate limit with a friendly error", async () => {
    const { RateLimitError } = await import("@/lib/rate-limit");
    rateLimitMock.mockRejectedValueOnce(new RateLimitError(120));
    const result = await createProject(fields);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("2 minutes") });
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it("stops at the project cap", async () => {
    prisma.project.count.mockResolvedValue(500);
    expect((await createProject(fields)).ok).toBe(false);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it("keys edit field errors by field", async () => {
    const result = await saveEditedContent("c1", { caption: "x", hashtags: [], videoScript: "", adHeadlines: ["h".repeat(101)] });
    expect(result).toMatchObject({ ok: false, fieldErrors: { adHeadlines: expect.any(String) } });
  });
});

describe("deleteProject", () => {
  it("deletes the project and removes its photos", async () => {
    prisma.project.findFirst.mockResolvedValue({ photoPaths: ["u1/projects/a.png", "u2/projects/evil.png"] });
    expect(await deleteProject("p1")).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(["u1/projects/a.png"]);
  });
});
