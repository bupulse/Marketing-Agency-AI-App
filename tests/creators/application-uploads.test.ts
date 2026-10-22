import { beforeEach, describe, expect, it, vi } from "vitest";

// Files sent with an application (lib/creators/application-uploads.ts, startApplicationUpload and submitApplication in
// lib/creators/apply.ts): a signed upload URL only for a live campaign's UPLOAD question, photos or videos as it
// accepts, 50 MB at most, rate limited; on submit each path must be this campaign's upload and there; files nobody
// applied with go after 2 days.

const h = vi.hoisted(() => ({
  campaign: vi.fn(),
  createMany: vi.fn(async () => ({ count: 1 })),
  findMany: vi.fn(async () => [] as { answers: unknown }[]),
  findCampaign: vi.fn(),
  rateLimit: vi.fn<(key: string, rule: unknown) => Promise<void>>(async () => undefined),
  signedUpload: vi.fn(async (path: string) => ({ data: { path, token: "tok" }, error: null })),
  info: vi.fn(async () => ({ data: { contentType: "video/mp4", size: 1_000_000 }, error: null }) as { data: { contentType: string; size: number } | null; error: unknown }),
  list: vi.fn(),
  remove: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/db", () => ({ prisma: { creatorCampaign: { findUnique: h.findCampaign }, campaignCreator: { createMany: h.createMany, findMany: h.findMany } } }));
vi.mock("@/lib/entitlements", () => ({ hasFeature: vi.fn(async () => true) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: h.rateLimit }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUploadUrl: h.signedUpload, info: h.info, list: h.list, remove: h.remove, createSignedUrl: vi.fn() }) } }),
}));

import { applicationFileProblem, checkApplicationUploads, cleanupApplicationUploads, isApplicationUploadPath } from "@/lib/creators/application-uploads";
import { startApplicationUpload, submitApplication } from "@/lib/creators/apply";
import { RateLimitError } from "@/lib/rate-limit";

const CAMPAIGN = "cmcampaign0001";
const PATH = `applications/${CAMPAIGN}/0b9f3c2e-1a2b-4c3d-9e8f-001122334455.mp4`;
const upload = { id: "intro", type: "UPLOAD", accept: "VIDEO", label: "Intro video", required: true };

function row(over: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN,
    slug: "summer",
    name: "Summer",
    brief: "Film the juice",
    rules: null,
    status: "LIVE",
    acceptingApplications: true,
    listed: true,
    hiddenAt: null,
    startsOn: new Date("2026-11-01T00:00:00Z"),
    endsOn: new Date("2026-11-30T00:00:00Z"),
    platforms: ["instagram"],
    mentions: [],
    currency: "RWF",
    payRules: { ratePerThousand: 2000 },
    viewTargetPerCreator: null,
    viewTargetCampaign: null,
    questions: null,
    applicationForm: { intro: null, phone: "REQUIRED", samples: "OPTIONAL", fields: [upload] },
    requirements: null,
    formats: [],
    dos: [],
    donts: [],
    files: null,
    look: null,
    businessId: "b1",
    business: { id: "b1", name: "Juice Co", country: "Rwanda", timezone: "Africa/Kigali", logoUrl: null, brandColors: [] },
    periods: [],
    ...over,
  };
}

const form = (extra: [string, string][] = []) => {
  const fd = new FormData();
  for (const [k, v] of [["firstName", "Ana"], ["lastName", "Uwase"], ["email", "ana@example.com"], ["phone", "+250791954277"], ["networks", "instagram"], ["handle_instagram", "ana"], ["followers_instagram", "2k"], ...extra] as [string, string][]) fd.append(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.campaign.mockReset();
  h.findCampaign.mockReset().mockImplementation(async () => row());
  h.info.mockResolvedValue({ data: { contentType: "video/mp4", size: 1_000_000 }, error: null });
});

describe("upload paths and files", () => {
  it("names only this campaign's uploads", () => {
    expect(isApplicationUploadPath(PATH, CAMPAIGN)).toBe(true);
    expect(isApplicationUploadPath(PATH, "cmother000001")).toBe(false);
    expect(isApplicationUploadPath(`applications/${CAMPAIGN}/../p1/${CAMPAIGN}/x.mp4`, CAMPAIGN)).toBe(false);
    expect(isApplicationUploadPath(`applications/${CAMPAIGN}/0b9f3c2e-1a2b-4c3d-9e8f-001122334455.exe`, CAMPAIGN)).toBe(false);
  });

  it("takes photos or videos as the question asks, up to 50 MB", () => {
    expect(applicationFileProblem({ type: "video/mp4", size: 10 }, "VIDEO")).toBeNull();
    expect(applicationFileProblem({ type: "image/png", size: 10 }, "VIDEO")).toMatch(/video/);
    expect(applicationFileProblem({ type: "video/mp4", size: 10 }, "IMAGE")).toMatch(/photo/);
    expect(applicationFileProblem({ type: "application/pdf", size: 10 }, "ANY")).toMatch(/photo or a video/);
    expect(applicationFileProblem({ type: "image/jpeg", size: 51 * 1024 * 1024 }, "ANY")).toMatch(/50 MB/);
  });
});

describe("startApplicationUpload", () => {
  it("gives a signed URL under applications/<campaignId>/ for a live campaign's upload question", async () => {
    const r = await startApplicationUpload("summer", "intro", { type: "video/mp4", size: 5_000_000 }, "1.2.3.4");
    expect(r).toMatchObject({ ok: true, token: "tok" });
    if (r.ok) expect(isApplicationUploadPath(r.path, CAMPAIGN)).toBe(true);
    expect(h.rateLimit).toHaveBeenCalledTimes(2);
    expect(h.rateLimit.mock.calls[0][0]).toMatch(/^creator-apply-upload:[0-9a-f]{32}$/);
    expect(h.rateLimit.mock.calls[1][0]).toBe(`creator-apply-upload-campaign:${CAMPAIGN}`);
  });

  it("refuses closed campaigns, other questions, wrong files and too many uploads", async () => {
    h.findCampaign.mockImplementationOnce(async () => row({ status: "PAUSED" }));
    expect(await startApplicationUpload("summer", "intro", { type: "video/mp4", size: 5 }, null)).toMatchObject({ ok: false, error: expect.stringMatching(/not taking/) });
    h.findCampaign.mockImplementationOnce(async () => row({ hiddenAt: new Date() }));
    expect((await startApplicationUpload("summer", "intro", { type: "video/mp4", size: 5 }, null)).ok).toBe(false);
    expect(await startApplicationUpload("summer", "other", { type: "video/mp4", size: 5 }, null)).toMatchObject({ ok: false, error: expect.stringMatching(/does not take files/) });
    expect(await startApplicationUpload("summer", "intro", { type: "image/png", size: 5 }, null)).toMatchObject({ ok: false, error: expect.stringMatching(/video/) });
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(600));
    expect((await startApplicationUpload("summer", "intro", { type: "video/mp4", size: 5 }, null)).ok).toBe(false);
    expect(h.signedUpload).not.toHaveBeenCalled();
  });
});

describe("submitting with a file", () => {
  it("saves the application with the upload's path once the file is there", async () => {
    expect(await submitApplication("summer", form([["q_intro", PATH]]), "1.2.3.4")).toEqual({ ok: true });
    expect(h.info).toHaveBeenCalledWith(PATH);
    expect((h.createMany.mock.calls[0] as unknown as [{ data: { answers: unknown; name: string; phone: string }[] }])[0].data[0]).toMatchObject({ name: "Ana Uwase", phone: "+250791954277", answers: { intro: PATH } });
  });

  it("refuses a path of another campaign, a missing file and one that does not fit", async () => {
    expect(await submitApplication("summer", form([["q_intro", PATH.replace(CAMPAIGN, "cmother000001")]]), null)).toEqual({ ok: false, errors: { q_intro: "Upload the file again." } });
    h.info.mockResolvedValueOnce({ data: null, error: new Error("not found") });
    expect(await submitApplication("summer", form([["q_intro", PATH]]), null)).toEqual({ ok: false, errors: { q_intro: "Upload the file again." } });
    h.info.mockResolvedValueOnce({ data: { contentType: "image/png", size: 10 }, error: null });
    expect(await submitApplication("summer", form([["q_intro", PATH]]), null)).toEqual({ ok: false, errors: { q_intro: "Upload the file again." } });
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it("the required upload must be sent", async () => {
    expect(await submitApplication("summer", form(), null)).toEqual({ ok: false, errors: { q_intro: "Please answer this question." } });
  });

  it("checks nothing more for forms without uploads", async () => {
    const errors = {};
    await checkApplicationUploads(CAMPAIGN, [], {}, errors);
    expect(errors).toEqual({});
    expect(h.info).not.toHaveBeenCalled();
  });
});

describe("cleanupApplicationUploads", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const file = (name: string, created: string) => ({ name, id: name, created_at: created });

  it("deletes uploads older than 2 days that no application uses", async () => {
    const used = "0b9f3c2e-1a2b-4c3d-9e8f-001122334455.mp4";
    h.list.mockImplementation(async (folder: string) => (folder === "applications" ? { data: [{ name: CAMPAIGN, id: null }, { name: "../x", id: null }] } : { data: [file(used, "2026-11-01T00:00:00Z"), file("aaaaaaaa-1a2b-4c3d-9e8f-001122334455.mp4", "2026-11-01T00:00:00Z"), file("bbbbbbbb-1a2b-4c3d-9e8f-001122334455.mp4", "2026-11-10T00:00:00Z")] }));
    h.findMany.mockResolvedValueOnce([{ answers: { intro: `applications/${CAMPAIGN}/${used}` } }, { answers: null }]);
    expect(await cleanupApplicationUploads(now)).toBe(1);
    expect(h.remove).toHaveBeenCalledWith([`applications/${CAMPAIGN}/aaaaaaaa-1a2b-4c3d-9e8f-001122334455.mp4`]);
  });

  it("deletes every upload of a campaign that ended 60 days ago, or is gone", async () => {
    h.list.mockImplementation(async (folder: string) => (folder === "applications" ? { data: [{ name: CAMPAIGN, id: null }] } : { data: [file("bbbbbbbb-1a2b-4c3d-9e8f-001122334455.mp4", "2026-11-10T00:00:00Z")] }));
    h.findCampaign.mockResolvedValueOnce(null);
    expect(await cleanupApplicationUploads(now)).toBe(1);
    expect(h.findMany).not.toHaveBeenCalled();
  });
});
