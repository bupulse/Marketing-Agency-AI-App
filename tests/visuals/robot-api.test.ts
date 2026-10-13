import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  peek: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {
    constructor(public retryAfterSeconds: number) {
      super("Too many requests");
    }
  }
  return { rateLimit: mocks.rateLimit, RateLimitError, RATE_LIMITS: { videoRobot: { limit: 120, windowSeconds: 3600 } } };
});
vi.mock("@/lib/visuals/robot", () => ({
  ROBOT_MAX_CLAIM: 5,
  ROBOT_FAILURES: ["render_failed", "unsupported", "timeout", "too_large", "upload_failed", "complete_failed"],
  claimRobotVideos: mocks.claim,
  completeRobotVideo: mocks.complete,
  failRobotVideo: mocks.fail,
  peekRobotVideos: mocks.peek,
  recordRobotRun: mocks.record,
}));

import { RateLimitError } from "@/lib/rate-limit";
import { safeEqual } from "@/lib/visuals/robot-auth";
import { POST as claim } from "@/app/api/robot/videos/claim/route";
import { POST as complete } from "@/app/api/robot/videos/complete/route";
import { POST as fail } from "@/app/api/robot/videos/fail/route";
import { POST as peek } from "@/app/api/robot/videos/peek/route";
import { POST as report } from "@/app/api/robot/videos/report/route";
import type { NextRequest } from "next/server";

const JOB = "00000000-0000-4000-8000-000000000001";
const req = (body: unknown, auth: string | null = "Bearer s3cret") =>
  new Request("https://app.example/api/robot/videos/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VIDEO_ROBOT_SECRET = "s3cret";
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.claim.mockResolvedValue([]);
  mocks.peek.mockResolvedValue(0);
});

describe("robot API auth", () => {
  const routes = { claim, complete, fail, peek, report };

  it.each(Object.entries(routes))("%s is off (404) while VIDEO_ROBOT_SECRET is unset", async (_name, route) => {
    delete process.env.VIDEO_ROBOT_SECRET;
    expect((await route(req({}))).status).toBe(404);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it.each(Object.entries(routes))("%s refuses a missing or wrong secret", async (_name, route) => {
    expect((await route(req({}, null))).status).toBe(401);
    expect((await route(req({}, "Bearer wrong"))).status).toBe(401);
    expect((await route(req({}, "s3cret"))).status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("is rate-limited per IP before the secret is compared", async () => {
    mocks.rateLimit.mockRejectedValue(new RateLimitError(60));
    expect((await claim(req({}))).status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledWith("video-robot:203.0.113.9", { limit: 120, windowSeconds: 3600 });
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("on a host, keys the limit on the host's trusted client IP, never x-forwarded-for", async () => {
    const before = process.env.PLATFORM;
    process.env.PLATFORM = "netlify";
    try {
      const request = new Request("https://app.example/api/robot/videos/claim", { method: "POST", headers: { authorization: "Bearer s3cret", "x-forwarded-for": "198.51.100.1", "x-nf-client-connection-ip": "203.0.113.7" }, body: "{}" }) as unknown as NextRequest;
      await claim(request);
      expect(mocks.rateLimit).toHaveBeenCalledWith("video-robot:203.0.113.7", expect.anything());
      mocks.rateLimit.mockClear();
      // Without the host's header: one shared bucket, not a key the caller picked.
      await claim(req({}));
      expect(mocks.rateLimit).toHaveBeenCalledWith("video-robot:unknown", expect.anything());
    } finally {
      if (before === undefined) delete process.env.PLATFORM;
      else process.env.PLATFORM = before;
    }
  });

  it("compares in constant time, length included", () => {
    expect(safeEqual("Bearer a", "Bearer a")).toBe(true);
    expect(safeEqual("Bearer a", "Bearer ab")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});

describe("robot API calls", () => {
  it("claim passes max and format, and validates them", async () => {
    mocks.claim.mockResolvedValue([{ job: JOB }]);
    const r = await claim(req({ max: 2, format: "webm" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ jobs: [{ job: JOB }] });
    expect(mocks.claim).toHaveBeenCalledWith({ max: 2, format: "webm" });
    expect((await claim(req({ max: 50 }))).status).toBe(400);
    expect((await claim(req({ format: "gif" }))).status).toBe(400);
  });

  it("complete takes only a job id (never a storage path) and maps outcomes", async () => {
    mocks.complete.mockResolvedValueOnce({ ok: true, seconds: 12 });
    expect((await complete(req({ job: JOB }))).status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(JOB);
    mocks.complete.mockResolvedValueOnce({ ok: false, error: "unknown_job" });
    expect((await complete(req({ job: JOB }))).status).toBe(404);
    mocks.complete.mockResolvedValueOnce({ ok: false, error: "rejected" });
    expect((await complete(req({ job: JOB }))).status).toBe(422);
    expect((await complete(req({ job: "../../etc" }))).status).toBe(400);
  });

  it("fail accepts only known reason codes", async () => {
    mocks.fail.mockResolvedValue({ ok: true, attempts: 1 });
    expect((await fail(req({ job: JOB, reason: "timeout" }))).status).toBe(200);
    expect((await fail(req({ job: JOB, reason: "Kigali Kicks caption broke" }))).status).toBe(400);
    expect(mocks.fail).toHaveBeenCalledTimes(1);
  });

  it("report and an idle peek leave a heartbeat of counts", async () => {
    expect((await report(req({ claimed: 2, made: 1, failed: 1 }))).status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith({ claimed: 2, made: 1, failed: 1 });
    expect((await report(req({ claimed: "two" }))).status).toBe(400);
    const r = await peek(req({}));
    expect(await r.json()).toEqual({ waiting: 0 });
    expect(mocks.record).toHaveBeenLastCalledWith({ claimed: 0, made: 0, failed: 0, waiting: 0 });
  });
});
