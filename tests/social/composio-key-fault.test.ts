import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "./helpers";

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
vi.mock("@/lib/social/inbox/budget", () => ({ countComposioCalls: vi.fn(async () => {}) }));

import { composioApi, isKeyRefusal } from "@/lib/social/composio/client";
import { resetServiceFaultsForTests, SERVICE_FAULTS_SETTING } from "@/lib/admin/service-faults";

beforeEach(() => {
  m.rows.clear();
  m.logError.mockClear();
  resetServiceFaultsForTests();
  process.env.COMPOSIO_API_KEY = "ak_refused_key";
});
afterEach(() => vi.unstubAllGlobals());

const TOOLKITS = "https://backend.composio.dev/api/v3/toolkits?limit=1";

describe("Composio refusing BuPulse's key", () => {
  it("counts only clear API-key wording as a key refusal", () => {
    expect(isKeyRefusal(401, "Invalid API key")).toBe(true);
    expect(isKeyRefusal(403, "Invalid API key provided")).toBe(true);
    expect(isKeyRefusal(401, "")).toBe(false);
    expect(isKeyRefusal(403, "You do not have access to this connected account")).toBe(false);
    expect(isKeyRefusal(500, "Invalid API key")).toBe(false);
  });

  it("records one fault, stops calling Composio with that key, and lets a newly pasted key through", async () => {
    const fetch = mockFetch(jsonResponse({ error: { message: "Invalid API key" } }, { status: 401 }));
    const first = (await composioApi("facebook", "GET", "/connected_accounts?x=1").catch((e: unknown) => e)) as Error & { serviceFault?: string };
    expect(first.message).toContain("paused on our side");
    expect(first.serviceFault).toBe("composio:key");
    expect(m.rows.get(SERVICE_FAULTS_SETTING)).toHaveProperty("composio:key");
    expect(m.logError).toHaveBeenCalledTimes(1);

    // The same key again (within its 15-minute retry): Composio is not called at all.
    for (let i = 0; i < 5; i++) await composioApi("facebook", "GET", "/connected_accounts?x=1").catch(() => null);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(m.logError).toHaveBeenCalledTimes(1);

    // The owner pastes a new key: it is used at once, and the good answer clears the fault.
    process.env.COMPOSIO_API_KEY = "ak_new_key";
    fetch.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await expect(composioApi("facebook", "GET", "/connected_accounts?x=1")).resolves.toEqual({ items: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(m.rows.get(SERVICE_FAULTS_SETTING)).not.toHaveProperty("composio:key");
  });

  it("one client's 403 in other words never pauses everyone: the key check passes, nothing is recorded", async () => {
    const fetch = vi.fn(async (url: string) => (url === TOOLKITS ? jsonResponse({ items: [] }) : jsonResponse({ error: { message: "Forbidden: connected account belongs to another user" } }, { status: 403 })));
    vi.stubGlobal("fetch", fetch);
    const error = (await composioApi("instagram", "GET", "/connected_accounts/ca_1").catch((e: unknown) => e)) as Error & { serviceFault?: string };
    expect(error.serviceFault).toBeUndefined();
    expect(error.message).toContain("Forbidden");
    expect(fetch.mock.calls.map((c) => c[0])).toContain(TOOLKITS);
    expect(m.rows.get(SERVICE_FAULTS_SETTING)).toBeUndefined();
    // The next call goes to Composio as normal.
    await composioApi("instagram", "GET", "/connected_accounts/ca_1").catch(() => null);
    expect(fetch.mock.calls.filter((c) => c[0] !== TOOLKITS)).toHaveLength(2);
  });

  it("a 401 in other words is a key refusal only when the key check is refused too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Unauthorized" }, { status: 401 })));
    const error = (await composioApi("facebook", "GET", "/connected_accounts?x=1").catch((e: unknown) => e)) as Error & { serviceFault?: string };
    expect(error.serviceFault).toBe("composio:key");
  });
});
