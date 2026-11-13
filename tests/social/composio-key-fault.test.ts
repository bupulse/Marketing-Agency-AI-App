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

describe("Composio refusing BuPulse's key", () => {
  it("knows a key refusal from other 403s", () => {
    expect(isKeyRefusal(401, "")).toBe(true);
    expect(isKeyRefusal(403, "Invalid API key provided")).toBe(true);
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
});
