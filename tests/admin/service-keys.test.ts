import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";

// Keys entered in Admin -> Services (lib/admin/service-keys.ts): saved encrypted in AdminSetting "services.keys", put
// in process.env for the code that reads it (a saved value wins over the hosting environment's; removing it brings the
// environment's back), audited without the value, and custom keys that never replace a variable the host sets.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, fetch: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/paddle", () => ({ paddle: {}, paddleApi: vi.fn(async () => []) }));

import { listServices, listServicesWithKeys, testService } from "@/lib/admin/services";
import { getCustomKey, loadServiceKeys, removeCustomKey, removeServiceKey, resetServiceKeysForTests, saveCustomKey, saveServiceKey, SERVICE_KEYS_SETTING } from "@/lib/admin/service-keys";
import { customNameProblem, isSavableKey, keyValueProblem, keysWhere, SAVABLE_KEYS } from "@/lib/admin/service-keys-rules";
import { scrubSecrets } from "@/lib/admin/scrub";
import { SERVICES } from "@/lib/admin/service-catalog";
import { getTtsProvider, setTtsProvider } from "@/lib/ai/tts";
import { getTextProvider } from "@/lib/ai/index";
import { consoleContext } from "@/lib/admin/types";

const CONSOLE = consoleContext("198.51.100.1");
const code = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "thrown");
const stored = () => JSON.stringify(h.db.adminSetting.rows.find((r) => r.key === SERVICE_KEYS_SETTING)?.value ?? null);
const audit = () => h.db.auditLog.rows;

const GEMINI = "AIzaSyFAKE-saved-in-admin-000000000001";
const HOST_GEMINI = "AIzaSyFAKE-hosting-environment-0000002";
const SEEDANCE = "ark-FAKE-seedance-key-0000000000000003";

beforeEach(() => {
  h.db = createFakeDb();
  resetServiceKeysForTests();
  vi.clearAllMocks();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  delete process.env.ENCRYPTION_KEY_ID;
  for (const n of ["GEMINI_API_KEY", "SEEDANCE_API_KEY", "COMPOSIO_API_KEY", "ELEVENLABS_API_KEY", "GEMINI_TEXT_MODEL", "SEEDREAM_API_KEY", "MY_HOST_ONLY_KEY", "AI_TEXT_PROVIDER"]) delete process.env[n];
  h.fetch.mockReset();
  vi.stubGlobal("fetch", h.fetch);
});

describe("which keys can be saved", () => {
  it("every service's keys except Supabase (needed to start) and Paddle (its own Settings form)", () => {
    expect(keysWhere("supabase")).toBe("host");
    expect(keysWhere("paddle")).toBe("settings");
    expect(keysWhere("woocommerce")).toBe("none");
    for (const id of ["gemini", "elevenlabs", "resend", "meta", "seedance", "composio"] as const) expect(keysWhere(id)).toBe("here");
    expect(isSavableKey("GEMINI_API_KEY")).toBe(true);
    expect(isSavableKey("GEMINI_TEXT_MODEL")).toBe(true);
    for (const n of ["DATABASE_URL", "SUPABASE_SECRET_KEY", "PADDLE_API_KEY", "ENCRYPTION_KEY", "CRON_SECRET"]) expect(isSavableKey(n)).toBe(false);
    for (const [name, id] of SAVABLE_KEYS) expect(SERVICES.find((s) => s.id === id)!.env.concat(SERVICES.find((s) => s.id === id)!.optionalEnv ?? [])).toContain(name);
  });

  it("lists Seedance 2.0 and Composio with their keys", () => {
    const seedance = SERVICES.find((s) => s.id === "seedance")!;
    expect(seedance.env).toEqual(["SEEDANCE_API_KEY"]);
    expect(seedance.optionalEnv).toEqual(["SEEDANCE_MODEL", "SEEDANCE_BASE_URL"]);
    expect(SERVICES.find((s) => s.id === "composio")!.env).toEqual(["COMPOSIO_API_KEY"]);
  });

  it("refuses values that cannot be a key and custom names that clash", () => {
    expect(keyValueProblem("GEMINI_API_KEY", "")).toMatch(/Paste/);
    expect(keyValueProblem("GEMINI_API_KEY", "has a space inside")).toMatch(/no spaces/);
    expect(keyValueProblem("GEMINI_API_KEY", "short")).toMatch(/too short/);
    expect(keyValueProblem("GEMINI_API_KEY", "line1\nline2xx")).toMatch(/one line/);
    expect(keyValueProblem("GEMINI_TEXT_MODEL", "gemini-3-flash")).toBeNull();
    expect(customNameProblem("lowercase")).toMatch(/capital letters/);
    expect(customNameProblem("GEMINI_API_KEY")).toMatch(/belongs to a service/);
    expect(customNameProblem("DATABASE_URL")).toMatch(/belongs to a service|BuPulse's own/);
    expect(customNameProblem("NEXT_PUBLIC_X")).toMatch(/BuPulse's own/);
    expect(customNameProblem("CRON_SECRET")).toMatch(/BuPulse's own/);
    expect(customNameProblem("SEEDREAM_API_KEY", { hostSet: true })).toMatch(/hosting environment/);
    expect(customNameProblem("SEEDREAM_API_KEY")).toBeNull();
  });
});

describe("saving a service key", () => {
  it("encrypts it, puts it in process.env, audits only the name and ending, and shows where it comes from", async () => {
    await saveServiceKey(CONSOLE, { name: "GEMINI_API_KEY", value: GEMINI });
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);
    expect(stored()).not.toContain(GEMINI);
    expect(stored()).toContain("v1:1:");
    const a = audit().at(-1)!;
    expect(a.action).toBe("save_service_key");
    expect(a.target).toBe("service:gemini");
    expect(JSON.stringify(a)).not.toContain(GEMINI);
    expect(a.after).toEqual({ variable: "GEMINI_API_KEY", ending: GEMINI.slice(-4) });

    const gemini = (await listServices()).find((s) => s.id === "gemini")!;
    expect(gemini.env[0]).toMatchObject({ name: "GEMINI_API_KEY", set: true, source: "saved", shown: GEMINI.slice(-4), hostSet: false });
    expect(gemini.configured).toBe("configured");
    expect(JSON.stringify(gemini)).not.toContain(GEMINI);
  });

  it("wins over the hosting environment while saved; removing it brings the hosting value back", async () => {
    process.env.GEMINI_API_KEY = HOST_GEMINI;
    expect((await listServices()).find((s) => s.id === "gemini")!.env[0]).toMatchObject({ source: "host", shown: null });
    await saveServiceKey(CONSOLE, { name: "GEMINI_API_KEY", value: GEMINI });
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);
    expect((await listServices()).find((s) => s.id === "gemini")!.env[0]).toMatchObject({ source: "saved", hostSet: true });
    const r = await removeServiceKey(CONSOLE, { name: "GEMINI_API_KEY" });
    expect(r.fallback).toBe(true);
    expect(process.env.GEMINI_API_KEY).toBe(HOST_GEMINI);
    expect(audit().at(-1)!.action).toBe("remove_service_key");
  });

  it("removing a key that only lived here leaves it unset", async () => {
    await saveServiceKey(CONSOLE, { name: "SEEDANCE_API_KEY", value: SEEDANCE });
    expect((await removeServiceKey(CONSOLE, { name: "SEEDANCE_API_KEY" })).fallback).toBe(false);
    expect(process.env.SEEDANCE_API_KEY).toBeUndefined();
    expect(await code(removeServiceKey(CONSOLE, { name: "SEEDANCE_API_KEY" }))).toBe("not_found");
  });

  it("refuses names that are not a service's key, bad values, and saving without ENCRYPTION_KEY", async () => {
    expect(await code(saveServiceKey(CONSOLE, { name: "DATABASE_URL", value: "postgres://x" }))).toBe("invalid");
    expect(await code(saveServiceKey(CONSOLE, { name: "PADDLE_API_KEY", value: "pdl_sdbx_apikey_abcdefgh" }))).toBe("invalid");
    expect(await code(saveServiceKey(CONSOLE, { name: "GEMINI_API_KEY", value: "two words here" }))).toBe("invalid");
    delete process.env.ENCRYPTION_KEY;
    expect(await code(saveServiceKey(CONSOLE, { name: "GEMINI_API_KEY", value: GEMINI }))).toBe("invalid");
    expect(h.db.adminSetting.rows).toHaveLength(0);
  });

  it("shows a plain setting in full and clears the last test of the service", async () => {
    h.db.serviceCheck.rows.push({ service: "gemini", ok: false, latencyMs: 3, message: "old", checkedAt: new Date() });
    await saveServiceKey(CONSOLE, { name: "GEMINI_TEXT_MODEL", value: "gemini-3-flash" });
    const gemini = (await listServices()).find((s) => s.id === "gemini")!;
    expect(gemini.optionalEnv.find((e) => e.name === "GEMINI_TEXT_MODEL")).toMatchObject({ source: "saved", shown: "gemini-3-flash" });
    expect(gemini.lastCheck).toBeNull();
  });

  it("reaches another server instance on its next load (a fresh process reads the saved row)", async () => {
    await saveServiceKey(CONSOLE, { name: "GEMINI_API_KEY", value: GEMINI });
    // Another instance: nothing loaded yet, the hosting environment has no key.
    resetServiceKeysForTests();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    await loadServiceKeys();
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);
  });

  it("keeps the last values when the database cannot be read, and never throws", async () => {
    await saveServiceKey(CONSOLE, { name: "GEMINI_API_KEY", value: GEMINI });
    h.db.adminSetting.findUnique.mockRejectedValueOnce(new Error("db down"));
    await expect(loadServiceKeys({ force: true })).resolves.toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);
  });

  it("a value that no longer decrypts is reported and not used", async () => {
    await saveServiceKey(CONSOLE, { name: "GEMINI_API_KEY", value: GEMINI });
    resetServiceKeysForTests();
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const { services, unreadable } = await listServicesWithKeys();
    expect(unreadable).toEqual(["GEMINI_API_KEY"]);
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(services.find((s) => s.id === "gemini")!.env[0]).toMatchObject({ set: false, source: null });
  });
});

describe("providers pick up a new key", () => {
  it("the text provider and the voice provider are rebuilt when the key changes", async () => {
    await saveServiceKey(CONSOLE, { name: "GEMINI_API_KEY", value: GEMINI });
    const first = getTextProvider();
    expect(getTextProvider()).toBe(first);
    await saveServiceKey(CONSOLE, { name: "GEMINI_API_KEY", value: `${GEMINI}x` });
    expect(getTextProvider()).not.toBe(first);

    setTtsProvider(undefined);
    expect(getTtsProvider()).toBeNull();
    await saveServiceKey(CONSOLE, { name: "ELEVENLABS_API_KEY", value: "sk_FAKEelevenlabs000000000004" });
    expect(getTtsProvider()).not.toBeNull();
  });
});

describe("Test now for the new services", () => {
  it("Seedance lists video tasks with the saved key (free) and reports a rejected key", async () => {
    await saveServiceKey(CONSOLE, { name: "SEEDANCE_API_KEY", value: SEEDANCE });
    h.fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const ok = await testService(CONSOLE, "seedance");
    expect(ok.ok).toBe(true);
    const [url, init] = h.fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks?page_num=1&page_size=1");
    expect((init as RequestInit).headers).toMatchObject({ authorization: `Bearer ${SEEDANCE}` });
    h.fetch.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const bad = await testService(CONSOLE, "seedance");
    expect(bad).toMatchObject({ ok: false });
    expect(bad.message).toMatch(/rejected the key/);
    expect(bad.message).not.toContain(SEEDANCE);
  });

  it("Composio lists one toolkit with x-api-key", async () => {
    await saveServiceKey(CONSOLE, { name: "COMPOSIO_API_KEY", value: "ak_FAKEcomposio0000000000005" });
    h.fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect((await testService(CONSOLE, "composio")).ok).toBe(true);
    const [url, init] = h.fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://backend.composio.dev/api/v3/toolkits?limit=1");
    expect((init as RequestInit).headers).toMatchObject({ "x-api-key": "ak_FAKEcomposio0000000000005" });
  });

  it("without a key, Test now says where to add it", async () => {
    const r = await testService(CONSOLE, "composio");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Not set: COMPOSIO_API_KEY\. Add it on this card or in the hosting environment\./);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("custom keys", () => {
  it("adds one with its details, readable by its variable name, and scrubbed from messages", async () => {
    const value = "sr-FAKEseedream-custom-000006";
    const r = await saveCustomKey(CONSOLE, { envName: "seedream_api_key", label: "Seedream images", details: "BytePlus account of BuPulse", website: "console.byteplus.com", value });
    expect(r).toMatchObject({ envName: "SEEDREAM_API_KEY", created: true });
    expect(process.env.SEEDREAM_API_KEY).toBe(value);
    expect(await getCustomKey("SEEDREAM_API_KEY")).toBe(value);
    expect(scrubSecrets(`failed with ${value}`)).toBe("failed with [redacted]");
    const { custom } = await listServicesWithKeys();
    expect(custom).toEqual([expect.objectContaining({ envName: "SEEDREAM_API_KEY", label: "Seedream images", details: "BytePlus account of BuPulse", website: "https://console.byteplus.com/", shown: value.slice(-4), inUse: true })]);
    expect(stored()).not.toContain(value);
    expect(JSON.stringify(audit())).not.toContain(value);
    expect(audit().at(-1)!.action).toBe("add_custom_key");
  });

  it("edits details while keeping the value, replaces the value when given, and removes it", async () => {
    const { id } = await saveCustomKey(CONSOLE, { envName: "SEEDREAM_API_KEY", label: "Seedream", value: "first-value-000007" });
    await saveCustomKey(CONSOLE, { id, label: "Seedream 4", details: "new details" });
    expect(process.env.SEEDREAM_API_KEY).toBe("first-value-000007");
    await saveCustomKey(CONSOLE, { id, label: "Seedream 4", value: "second-value-000008" });
    expect(process.env.SEEDREAM_API_KEY).toBe("second-value-000008");
    const { custom } = await listServicesWithKeys();
    expect(custom[0]).toMatchObject({ label: "Seedream 4", details: "", shown: "0008" });
    await removeCustomKey(CONSOLE, { id });
    expect(process.env.SEEDREAM_API_KEY).toBeUndefined();
    expect(await getCustomKey("SEEDREAM_API_KEY")).toBeNull();
    expect(await code(removeCustomKey(CONSOLE, { id }))).toBe("not_found");
  });

  it("refuses a name the hosting environment sets, a duplicate, a service's own name and a missing value", async () => {
    process.env.MY_HOST_ONLY_KEY = "set-by-the-host";
    expect(await code(saveCustomKey(CONSOLE, { envName: "MY_HOST_ONLY_KEY", label: "Mine", value: "abcdefgh1234" }))).toBe("invalid");
    expect(process.env.MY_HOST_ONLY_KEY).toBe("set-by-the-host");
    expect(await code(saveCustomKey(CONSOLE, { envName: "GEMINI_API_KEY", label: "Gemini", value: "abcdefgh1234" }))).toBe("invalid");
    expect(await code(saveCustomKey(CONSOLE, { envName: "SEEDREAM_API_KEY", label: "Seedream" }))).toBe("invalid");
    expect(await code(saveCustomKey(CONSOLE, { envName: "SEEDREAM_API_KEY", label: "Seedream", website: "javascript:alert(1)", value: "abcdefgh1234" }))).toBe("invalid");
    await saveCustomKey(CONSOLE, { envName: "SEEDREAM_API_KEY", label: "Seedream", value: "abcdefgh1234" });
    expect(await code(saveCustomKey(CONSOLE, { envName: "SEEDREAM_API_KEY", label: "Again", value: "abcdefgh5678" }))).toBe("invalid");
    delete process.env.MY_HOST_ONLY_KEY;
  });
});
