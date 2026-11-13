import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAt, jsonResponse } from "./helpers";

const m = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  return {
    rows,
    logError: vi.fn(async () => {}),
    adminSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null),
      upsert: async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
        rows.set(where.key, rows.has(where.key) ? update.value : create.value);
        return {};
      },
    },
  };
});
vi.mock("@/lib/db", () => ({ prisma: { adminSetting: m.adminSetting } }));
vi.mock("@/lib/errors", () => ({ logError: m.logError }));

import { ensureProfile, isProfileLimit, PROFILE_LIMIT_MESSAGE, UploadPostError } from "@/lib/social/uploadpost/client";
import { resetServiceFaultsForTests, SERVICE_FAULTS_SETTING } from "@/lib/admin/service-faults";

const API = "https://api.upload-post.com/api";

beforeEach(() => {
  m.rows.clear();
  m.logError.mockClear();
  resetServiceFaultsForTests();
  process.env.UPLOAD_POST_API_KEY = "up_test_key_123";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UPLOAD_POST_API_KEY;
});

describe("Upload-Post's profile limit", () => {
  it("recognises Upload-Post's words for it", () => {
    expect(isProfileLimit("", "PROFILE_LIMIT_REACHED")).toBe(true);
    expect(isProfileLimit("You have reached the maximum number of profiles for your plan")).toBe(true);
    expect(isProfileLimit("Upload limit reached")).toBe(false);
  });

  it("one clear message and one Health item; pressing Connect again does not hammer Upload-Post", async () => {
    // Answers by URL: creating a profile is refused, looking one up finds none.
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `${API}/uploadposts/users` && init?.method === "POST") return jsonResponse({ success: false, error_code: "PROFILE_LIMIT_REACHED", message: "Profile limit reached" }, { status: 403 });
      return jsonResponse({ success: false, message: "Profile not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    const first = await ensureProfile("linkedin", "bupulse_biz3", "Shop").catch((e) => e);
    expect(first).toBeInstanceOf(UploadPostError);
    expect(first.message).toBe(PROFILE_LIMIT_MESSAGE);
    expect(first.status).toBe(403); // the connect route shows "paused on our side"
    expect(first.serviceFault).toBe("uploadpost:profile-limit");
    expect(m.rows.get(SERVICE_FAULTS_SETTING)).toHaveProperty("uploadpost:profile-limit");
    // Not reported as a plan (posting) limit.
    expect(m.rows.get(SERVICE_FAULTS_SETTING)).not.toHaveProperty("uploadpost:plan-limit");

    for (let i = 0; i < 4; i++) await ensureProfile("linkedin", "bupulse_biz3", "Shop").catch(() => null);
    const creates = fetch.mock.calls.filter((_, i) => callAt(fetch as never, i).init.method === "POST");
    // Within 30 minutes no new profile is asked for again: only cheap look-ups.
    expect(creates).toHaveLength(1);
    expect(m.logError).toHaveBeenCalledTimes(1);
  });

  it("a 429 while making a profile is rate limiting: no profile-limit or posting-limit item", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ success: false, message: "Too many requests" }, { status: 429 })));
    const error = await ensureProfile("linkedin", "bupulse_biz4", "").catch((e) => e);
    expect(error).toBeInstanceOf(UploadPostError);
    expect(error.status).toBe(429);
    expect(error.serviceFault).toBeUndefined();
    expect(m.rows.get(SERVICE_FAULTS_SETTING)).toBeUndefined();
  });

  it("a company that already has its profile still connects at the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") return jsonResponse({ success: false, error_code: "PROFILE_LIMIT_REACHED" }, { status: 403 });
        return jsonResponse({ success: true, profile: { username: "bupulse_biz1" } });
      }),
    );
    await expect(ensureProfile("linkedin", "bupulse_biz1", "")).resolves.toBeUndefined();
    expect(m.logError).not.toHaveBeenCalled();
  });
});
