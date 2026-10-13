import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as grant from "@/tests/stubs/entitlements";
// Plans are not part of this test's database: every plan feature is granted (tests/stubs/entitlements.ts).
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const prisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  post: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  serviceSwitch: { findMany: vi.fn() },
}));
const provider = vi.hoisted(() => ({ publish: vi.fn() }));
const connections = vi.hoisted(() => ({ loadCredentials: vi.fn(), markConnectionError: vi.fn() }));
const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
const media = vi.hoisted(() => ({ signPaths: vi.fn(), signPathsForNetwork: vi.fn(), adminStorageClient: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError }));
vi.mock("@/lib/social/connections", () => connections);
vi.mock("@/lib/social/registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/social/registry")>("@/lib/social/registry");
  return { ...actual, getProvider: () => provider };
});
vi.mock("@/lib/publishing/email", async () => {
  const actual = await vi.importActual<typeof import("@/lib/publishing/email")>("@/lib/publishing/email");
  return { ...actual, sendEmail: email.sendEmail };
});
vi.mock("@/lib/publishing/media", async () => {
  const actual = await vi.importActual<typeof import("@/lib/publishing/media")>("@/lib/publishing/media");
  return { ...actual, signPaths: media.signPaths, signPathsForNetwork: media.signPathsForNetwork, adminStorageClient: media.adminStorageClient };
});

import { backoffMinutes, claimDuePosts, MAX_ATTEMPTS, publishDue, publishPostsNow, STALE_LOCK_MINUTES, sweepStalePosts } from "@/lib/publishing/engine";
import { SocialError } from "@/lib/social/types";
import { clearSwitchCache } from "@/lib/admin/switch";

const finalError = (message: string, kind: "temporary" | "rate_limit" = "temporary") => new SocialError(message, kind, "facebook", undefined, "final");

const now = new Date("2026-10-07T10:00:00Z");

// $queryRaw serves the claim query from a queue; the sweep queries (stale and capped posts) answer from `sweeps`.
let claims: { id: string }[][] = [];
let claimDefault: { id: string }[] = [];
let sweeps: { id: string }[][] = [];
const isClaim = (strings: readonly string[]) => strings.join("?").includes(`SET "status" = 'PUBLISHING'`);
const claimCalls = () => prisma.$queryRaw.mock.calls.filter((c) => isClaim(c[0] as string[]));

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    businessId: "b1",
    connectionId: "c1",
    network: "facebook",
    status: "PUBLISHING",
    format: "POST",
    title: null,
    text: "Fresh bread today",
    hashtags: ["#bread"],
    mediaPaths: [] as string[],
    link: null,
    attempts: 1,
    connection: { id: "c1", postingMode: "AUTO", displayName: "Sunrise Bakery" } as { id: string; postingMode: string; displayName: string } | null,
    business: { id: "b1", name: "Sunrise", user: { email: "owner@example.com" } },
    ...overrides,
  };
}

/** Claims `p` once, then nothing. */
function claimOnce(p: ReturnType<typeof post>) {
  claims = [[{ id: p.id }]];
  prisma.post.findMany.mockResolvedValue([p]);
}

/** The update that settled the post (the last updateMany call). */
function settled() {
  const calls = prisma.post.updateMany.mock.calls;
  return calls[calls.length - 1]?.[0] as { where: { id: string; status: string }; data: Record<string, unknown> };
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.resetAllMocks();
  // A frozen clock (timers stay real) so back-off waits are exact, never "about 1 minute".
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  claims = [];
  claimDefault = [];
  sweeps = [];
  prisma.$queryRaw.mockImplementation(async (strings: string[]) => (isClaim(strings) ? (claims.shift() ?? claimDefault) : (sweeps.shift() ?? [])));
  prisma.post.updateMany.mockResolvedValue({ count: 1 });
  prisma.post.update.mockResolvedValue({});
  prisma.mediaAsset.findMany.mockResolvedValue([]);
  connections.loadCredentials.mockResolvedValue({ connectionId: "c1", externalAccountId: "x", accountType: "page", accessToken: "t" });
  connections.markConnectionError.mockResolvedValue(undefined);
  provider.publish.mockResolvedValue({ externalId: "ext1", permalink: "https://facebook.com/ext1" });
  email.sendEmail.mockResolvedValue(true);
  prisma.serviceSwitch.findMany.mockResolvedValue([]);
  clearSwitchCache();
  media.adminStorageClient.mockReturnValue({});
  media.signPaths.mockImplementation(async (_c: unknown, paths: string[]) => new Map(paths.map((p) => [p, `https://signed.example/${p}`])));
  media.signPathsForNetwork.mockImplementation(async (c: unknown, paths: string[], _network: string, seconds: number) => ({ urls: await media.signPaths(c, paths, seconds), jpeg: new Set<string>() }));
  process.env.NEXT_PUBLIC_SITE_URL = "https://bupulse.test";
  process.env.ENCRYPTION_KEY = "test-key";
});

describe("claiming", () => {
  it("claims with one UPDATE ... RETURNING over locked rows, due posts only, never taking another run's rows", async () => {
    await claimDuePosts({ now, limit: 7 });
    const [strings, ...values] = claimCalls()[0];
    const sql = (strings as string[]).join("?");
    expect(sql).toMatch(/UPDATE "Post" SET "status" = 'PUBLISHING'/);
    expect(sql).toMatch(/RETURNING "id"/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/"status" = 'SCHEDULED'::"PostStatus" AND "scheduledAt" <=/);
    // A stale PUBLISHING post is never taken for another publish (it may be live already).
    expect(sql).not.toMatch(/"lockedAt" </);
    expect(sql).toMatch(/"attempts" </);
    expect(sql).toMatch(/"nextAttemptAt" IS NULL OR "nextAttemptAt" <=/);
    // Accounts being deleted are left alone (a nested SQL fragment among the values).
    expect(JSON.stringify(values)).toContain("deletionScheduledFor");
    expect(sql).toMatch(/LIMIT/);
    expect(values).toContain(7);
    expect(values).toContain(MAX_ATTEMPTS);
  });

  it("limits a manual publish to the business and the given posts", async () => {
    await publishPostsNow("b1", ["p1", "p2"], now);
    const [, ...values] = claimCalls()[0];
    // The business filter and the id list are nested SQL fragments among the values.
    const text = JSON.stringify(values);
    expect(text).toContain("b1");
    expect(text).toContain("p1");
    expect(text).toContain("businessId");
  });

  it("claims nothing for an empty id list without touching the database", async () => {
    expect(await claimDuePosts({ now, limit: 5, ids: [] })).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("asks only for what is left of the per-run limit", async () => {
    claimDefault = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }, { id: "p5" }];
    prisma.post.findMany.mockResolvedValue([]);
    await publishDue(now, { limit: 7 });
    const limits = claimCalls().map((call) => call[call.length - 1]);
    expect(limits).toEqual([5, 2]);
  });

  it("stops when nothing more is due", async () => {
    const result = await publishDue(now);
    expect(result).toEqual({ claimed: 0, published: 0, reminders: 0, retrying: 0, failed: 0, uncertain: 0 });
    expect(claimCalls()).toHaveLength(1);
  });
});

describe("back-off", () => {
  it("waits 1, 5, 15 and 60 minutes, then gives up after 5 attempts", () => {
    expect([1, 2, 3, 4].map(backoffMinutes)).toEqual([1, 5, 15, 60]);
    expect(backoffMinutes(5)).toBeNull();
    expect(backoffMinutes(9)).toBeNull();
  });

  it.each([
    [1, 1],
    [2, 5],
    [3, 15],
    [4, 60],
  ])("a temporary error on attempt %i retries in %i minutes", async (attempts, minutes) => {
    claimOnce(post({ attempts }));
    provider.publish.mockRejectedValue(new SocialError("busy", "temporary", "facebook"));
    const result = await publishDue(now);
    expect(result.retrying).toBe(1);
    const { data, where } = settled();
    expect(where.status).toBe("PUBLISHING");
    expect(data.status).toBe("SCHEDULED");
    expect(data.lockedAt).toBeNull();
    expect(data.nextAttemptAt).toEqual(new Date(now.getTime() + minutes * 60_000));
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it("honours a longer retry-after from the network", async () => {
    claimOnce(post({ attempts: 1 }));
    provider.publish.mockRejectedValue(new SocialError("slow down", "rate_limit", "facebook", 30 * 60));
    await publishDue(now);
    expect(settled().data.nextAttemptAt).toEqual(new Date(now.getTime() + 30 * 60_000));
  });

  it("fails after the 5th attempt and emails the owner", async () => {
    claimOnce(post({ attempts: 5 }));
    provider.publish.mockRejectedValue(new SocialError("still busy", "rate_limit", "facebook"));
    const result = await publishDue(now);
    expect(result.failed).toBe(1);
    expect(settled().data).toMatchObject({ status: "FAILED", lastError: "still busy" });
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toMatchObject({ to: "owner@example.com" });
  });
});

describe("publishing", () => {
  it("publishes with signed one-hour media URLs and records the result", async () => {
    claimOnce(post({ mediaPaths: ["u1/gallery/a.jpg"], network: "instagram" }));
    prisma.mediaAsset.findMany.mockResolvedValue([{ path: "u1/gallery/a.jpg", mimeType: "image/jpeg", width: 1080, height: 1350 }]);
    const result = await publishDue(now);
    expect(result).toMatchObject({ claimed: 1, published: 1 });
    expect(media.signPaths).toHaveBeenCalledWith(expect.anything(), ["u1/gallery/a.jpg"], 3600);
    const request = provider.publish.mock.calls[0][1];
    expect(request).toMatchObject({ format: "POST", text: "Fresh bread today\n\n#bread", media: [{ url: "https://signed.example/u1/gallery/a.jpg", mimeType: "image/jpeg", width: 1080 }] });
    expect(settled().data).toMatchObject({ status: "PUBLISHED", externalId: "ext1", permalink: "https://facebook.com/ext1", lockedAt: null });
    expect(settled().data.publishedAt instanceof Date).toBe(true);
  });

  it("never publishes a contest without its confirmed prize and rules: it goes back to waiting for the owner", async () => {
    claimOnce(post({ text: "Win [PRIZE]!", contest: {} }));
    await publishDue(now);
    expect(provider.publish).not.toHaveBeenCalled();
    expect(settled().data).toMatchObject({ status: "PENDING_APPROVAL", reviewNote: "Needs your confirmation: prize & rules" });
  });

  it("only settles posts that are still PUBLISHING", async () => {
    claimOnce(post());
    await publishDue(now);
    expect(settled().where).toEqual({ id: "p1", status: "PUBLISHING" });
  });

  it("fails a post whose photo is gone, without calling the network", async () => {
    claimOnce(post({ mediaPaths: ["u1/gallery/gone.jpg"] }));
    media.signPaths.mockResolvedValue(new Map());
    await publishDue(now);
    expect(provider.publish).not.toHaveBeenCalled();
    expect(settled().data).toMatchObject({ status: "FAILED" });
  });

  it("fails a post whose account was disconnected", async () => {
    claimOnce(post({ connection: null, connectionId: null }));
    const result = await publishDue(now);
    expect(result.failed).toBe(1);
    expect(provider.publish).not.toHaveBeenCalled();
  });

  it("never publishes twice: if saving fails after the network accepted, it logs loudly and does not resend", async () => {
    claimOnce(post());
    prisma.post.updateMany.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await publishDue(now);
    expect(provider.publish).toHaveBeenCalledTimes(1);
    expect(result.published).toBe(1);
    expect(logError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "publishing.save-after-publish", externalId: "ext1" }));
    expect(consoleError.mock.calls.flat().join(" ")).toMatch(/PUBLISHED ON facebook BUT NOT SAVED post=p1 externalId=ext1/);
    consoleError.mockRestore();
  });
});

describe("error kinds", () => {
  it("auth: fails the post, marks the connection and tells the owner to reconnect", async () => {
    claimOnce(post());
    const error = new SocialError("token revoked", "auth", "facebook");
    provider.publish.mockRejectedValue(error);
    const result = await publishDue(now);
    expect(result.failed).toBe(1);
    expect(connections.markConnectionError).toHaveBeenCalledWith("c1", error);
    expect(settled().data).toMatchObject({ status: "FAILED" });
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.subject).toMatch(/could not be published/);
    expect(sent.html).toContain("/dashboard/connections");
  });

  it("an auth error while loading credentials is handled the same way", async () => {
    claimOnce(post());
    connections.loadCredentials.mockRejectedValue(new SocialError("This account needs to be reconnected", "auth", "facebook"));
    await publishDue(now);
    expect(provider.publish).not.toHaveBeenCalled();
    expect(connections.markConnectionError).toHaveBeenCalledTimes(1);
    expect(settled().data).toMatchObject({ status: "FAILED" });
  });

  it("invalid: fails at once with the network's message, no retry, connection untouched", async () => {
    claimOnce(post());
    provider.publish.mockRejectedValue(new SocialError("Image too small", "invalid", "facebook"));
    await publishDue(now);
    expect(settled().data).toMatchObject({ status: "FAILED", lastError: "Image too small", nextAttemptAt: null });
    expect(connections.markConnectionError).not.toHaveBeenCalled();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("an unexpected error is retried with back-off, not lost", async () => {
    claimOnce(post({ attempts: 1 }));
    provider.publish.mockRejectedValue(new Error("boom"));
    const result = await publishDue(now);
    expect(result.retrying).toBe(1);
    expect(settled().data.status).toBe("SCHEDULED");
    expect(logError).toHaveBeenCalled();
  });
});

describe("reminders (NOTIFY accounts and SCRIPT posts)", () => {
  it("emails the caption, hashtags, 7-day image links and an I-posted-it link, then waits as NEEDS_ACTION", async () => {
    claimOnce(post({ network: "instagram", connection: { id: "c1", postingMode: "NOTIFY", displayName: "My Instagram" }, mediaPaths: ["u1/gallery/a.jpg", "u1/designs/d.png"] }));
    const result = await publishDue(now);
    expect(result).toMatchObject({ claimed: 1, reminders: 1 });
    expect(provider.publish).not.toHaveBeenCalled();
    expect(connections.loadCredentials).not.toHaveBeenCalled();
    expect(media.signPaths).toHaveBeenCalledWith(expect.anything(), ["u1/gallery/a.jpg", "u1/designs/d.png"], 7 * 24 * 60 * 60);
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe("owner@example.com");
    expect(sent.subject).toBe("Time to post on Instagram");
    expect(sent.text).toContain("Fresh bread today");
    expect(sent.text).toContain("#bread");
    expect(sent.text).toContain("https://signed.example/u1/gallery/a.jpg");
    expect(sent.text).toContain("https://signed.example/u1/designs/d.png");
    expect(sent.html).toMatch(/https:\/\/bupulse\.test\/posted\?token=/);
    expect(settled().data).toMatchObject({ status: "NEEDS_ACTION", lastError: null });
  });

  it("sends a post made for an app that is not connected (remindOnly) as a reminder", async () => {
    claimOnce(post({ network: "instagram", connection: null, connectionId: null, remindOnly: true, mediaPaths: ["u1/designs/d.png"] }));
    const result = await publishDue(now);
    expect(result).toMatchObject({ claimed: 1, reminders: 1, failed: 0 });
    expect(provider.publish).not.toHaveBeenCalled();
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.subject).toBe("Time to post on Instagram");
    expect(sent.text).toContain("not connected to BuPulse yet");
    expect(sent.text).toContain("https://signed.example/u1/designs/d.png");
    expect(settled().data).toMatchObject({ status: "NEEDS_ACTION" });
  });

  it("sends SCRIPT posts as reminders even on an AUTO account", async () => {
    claimOnce(post({ network: "tiktok", format: "SCRIPT", text: "0-5s: show the oven" }));
    const result = await publishDue(now);
    expect(result.reminders).toBe(1);
    expect(provider.publish).not.toHaveBeenCalled();
    expect(email.sendEmail.mock.calls[0][0].subject).toBe("Time to film and post on TikTok");
    expect(email.sendEmail.mock.calls[0][0].text).toContain("0-5s: show the oven");
    expect(settled().data.status).toBe("NEEDS_ACTION");
  });

  it("escapes the post text in the email HTML", async () => {
    claimOnce(post({ connection: { id: "c1", postingMode: "NOTIFY", displayName: "x" }, text: "<script>alert(1)</script>" }));
    await publishDue(now);
    expect(email.sendEmail.mock.calls[0][0].html).not.toContain("<script>");
  });

  it("retries later if the reminder email cannot be sent, instead of losing it", async () => {
    claimOnce(post({ connection: { id: "c1", postingMode: "NOTIFY", displayName: "x" }, attempts: 1 }));
    email.sendEmail.mockResolvedValue(false);
    const result = await publishDue(now);
    expect(result.retrying).toBe(1);
    expect(settled().data.status).toBe("SCHEDULED");
  });
});

describe("the calendar plan feature", () => {
  afterEach(() => {
    grant.missing.clear();
    grant.state.planUnknown = false;
    grant.state.block = null;
  });

  it("holds (never fails) the posts of a read-only account, with the reason on the post, until it pays", async () => {
    claimOnce(post({ attempts: 4 }));
    grant.state.block = "trial_expired";
    const result = await publishDue(now);
    expect(result).toMatchObject({ claimed: 1, retrying: 1, failed: 0, published: 0 });
    expect(provider.publish).not.toHaveBeenCalled();
    expect(settled().data).toMatchObject({ status: "SCHEDULED", attempts: 3, nextAttemptAt: null, lastError: grant.blockMessage("trial_expired") });
  });

  it("fails a claimed post of a company whose plan (resolved) lacks it, with the reason, instead of sending it", async () => {
    claimOnce(post({ attempts: 1 }));
    grant.missing.add("calendar");
    const result = await publishDue(now);
    expect(result).toMatchObject({ claimed: 1, failed: 1, published: 0, retrying: 0 });
    expect(provider.publish).not.toHaveBeenCalled();
    expect(settled().data).toMatchObject({ status: "FAILED", lastError: expect.stringMatching(/not part of your plan/) });
  });

  it("hands the post back to retry while the plan cannot be checked (catalog degraded, unknown plan key): never FAILED for good", async () => {
    claimOnce(post({ attempts: 4 })); // even on the last attempt
    grant.state.planUnknown = true;
    const result = await publishDue(now);
    expect(result).toMatchObject({ claimed: 1, retrying: 1, failed: 0, published: 0 });
    expect(provider.publish).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(settled().data).toMatchObject({ status: "SCHEDULED", attempts: 3, nextAttemptAt: null, lastError: null, lockedAt: null });
  });
});

describe("reminders while Resend is switched off in the admin console", () => {
  const resendOff = () => {
    prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "resend" }]);
    clearSwitchCache();
  };

  it("does not claim reminder posts (NOTIFY accounts and SCRIPT posts) while it is off, and claims them again when it is on", async () => {
    resendOff();
    await claimDuePosts({ now, limit: 5 });
    const [, ...values] = claimCalls()[0];
    expect(JSON.stringify(values)).toContain("NOTIFY");
    expect(JSON.stringify(values)).toContain("SCRIPT");
    expect(JSON.stringify(values)).toContain("remindOnly");
    prisma.serviceSwitch.findMany.mockResolvedValue([]);
    clearSwitchCache();
    prisma.$queryRaw.mockClear();
    await claimDuePosts({ now, limit: 5 });
    expect(JSON.stringify(claimCalls()[0].slice(1))).not.toContain("NOTIFY");
  });

  it("a reminder claimed just before the switch went off goes back to SCHEDULED with its attempt returned, never FAILED", async () => {
    claimOnce(post({ connection: { id: "c1", postingMode: "NOTIFY", displayName: "x" }, attempts: 4 })); // the last attempt
    resendOff();
    const result = await publishDue(now);
    expect(result).toMatchObject({ claimed: 1, retrying: 1, failed: 0, reminders: 0 });
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(settled().data).toMatchObject({ status: "SCHEDULED", attempts: 3, nextAttemptAt: null, lastError: null, lockedAt: null });
  });

  it("SCRIPT posts wait the same way, and the switch flipping while the email is sent does not burn an attempt", async () => {
    claimOnce(post({ network: "tiktok", format: "SCRIPT", attempts: 1 }));
    email.sendEmail.mockImplementation(async () => {
      resendOff();
      return false;
    });
    const result = await publishDue(now);
    expect(result).toMatchObject({ retrying: 1, failed: 0 });
    expect(settled().data).toMatchObject({ status: "SCHEDULED", attempts: 0, nextAttemptAt: null });
  });

  it("a genuine email failure with Resend on still counts the attempt and backs off", async () => {
    claimOnce(post({ connection: { id: "c1", postingMode: "NOTIFY", displayName: "x" }, attempts: 1 }));
    email.sendEmail.mockResolvedValue(false);
    await publishDue(now);
    expect(settled().data.status).toBe("SCHEDULED");
    expect(settled().data.nextAttemptAt).toBeInstanceOf(Date);
  });
});

describe("never republish a post that may already be live", () => {
  it("an error from the final call (timeout, 5xx) leaves the post for the owner to check, sends nothing again and emails", async () => {
    claimOnce(post({ attempts: 1 }));
    provider.publish.mockRejectedValue(finalError("Facebook took too long to answer"));
    const result = await publishDue(now);
    expect(result).toMatchObject({ uncertain: 1, retrying: 0, failed: 0 });
    expect(provider.publish).toHaveBeenCalledTimes(1);
    expect(settled().data).toMatchObject({ status: "NEEDS_ACTION", lastError: "We could not confirm this post went out. Check Facebook before retrying.", nextAttemptAt: null });
    expect(email.sendEmail.mock.calls[0][0].subject).toBe("Please check your Facebook post");
  });

  it("a final-stage error is not retried even on the first attempt, and a rate limit before posting still is", async () => {
    claimOnce(post({ attempts: 1 }));
    provider.publish.mockRejectedValue(new SocialError("slow down", "rate_limit", "facebook", 60));
    expect((await publishDue(now)).retrying).toBe(1);
  });

  it("an invalid or auth error from the final call is still a clear rejection", async () => {
    claimOnce(post());
    provider.publish.mockRejectedValue(new SocialError("Bad caption", "invalid", "facebook", undefined, "final"));
    expect((await publishDue(now)).failed).toBe(1);
  });

  it("a stale PUBLISHING post becomes NEEDS_ACTION with a message and an email, and is not published", async () => {
    sweeps = [[{ id: "stale1" }], []];
    prisma.post.findMany.mockResolvedValue([post({ id: "stale1", status: "NEEDS_ACTION" })]);
    expect(await sweepStalePosts(now)).toBe(1);
    expect(prisma.post.update).toHaveBeenCalledWith({ where: { id: "stale1" }, data: { lastError: "We could not confirm this post went out. Check Facebook before retrying." } });
    expect(email.sendEmail.mock.calls[0][0].subject).toBe("Please check your Facebook post");
    expect(provider.publish).not.toHaveBeenCalled();
    const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(/"status" = 'PUBLISHING'::"PostStatus" AND "lockedAt" </);
    expect(prisma.$queryRaw.mock.calls[0]).toContainEqual(new Date(now.getTime() - STALE_LOCK_MINUTES * 60_000));
  });

  it("posts that used all their attempts become FAILED with an email", async () => {
    sweeps = [[], [{ id: "capped" }]];
    prisma.post.findMany.mockResolvedValue([post({ id: "capped", status: "FAILED" })]);
    expect(await sweepStalePosts(now)).toBe(1);
    const sql = (prisma.$queryRaw.mock.calls[1][0] as string[]).join("?");
    expect(sql).toMatch(/"attempts" >=/);
    expect(email.sendEmail.mock.calls[0][0].subject).toMatch(/could not be published/);
  });

  it("publishDue sweeps first", async () => {
    sweeps = [[{ id: "stale1" }], []];
    prisma.post.findMany.mockResolvedValue([post({ id: "stale1", status: "NEEDS_ACTION" })]);
    await publishDue(now);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });
});
