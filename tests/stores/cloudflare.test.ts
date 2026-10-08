import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  widget: { businessId: "b1", allowedDomains: ["example.org"] as string[] },
  installs: new Map<string, Record<string, unknown>>(),
  conn: null as null | { businessId: string; tokenEncrypted: string; status: string },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    business: { findUnique: async () => ({ widgetKey: "KEY123", website: null }) },
    cloudflareConnection: {
      findUnique: async () => db.conn,
      upsert: async ({ create, update }: { create: never; update: never }) => (db.conn = { ...(db.conn ?? (create as object)), ...(update as object) } as never),
      updateMany: async ({ data }: { data: { status: string } }) => void (db.conn && (db.conn.status = data.status)),
    },
    chatWidget: {
      upsert: async () => db.widget,
      findUnique: async () => ({ lastSeenAt: null, lastSeenHost: null }),
      update: async ({ data }: { data: { allowedDomains: string[] } }) => void (db.widget.allowedDomains = data.allowedDomains),
    },
    cloudflareInstall: {
      findMany: async () => [...db.installs.values()],
      upsert: async ({ where, create, update }: { where: { businessId_zoneId: { zoneId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const k = where.businessId_zoneId.zoneId;
        db.installs.set(k, { ...(db.installs.get(k) ?? create), ...(db.installs.has(k) ? update : {}) });
      },
      deleteMany: async ({ where }: { where: { zoneId: string } }) => void db.installs.delete(where.zoneId),
    },
  },
}));

import { cf, tokenPageUrl, verifyToken } from "@/lib/cloudflare/client";
import { allowDomain, connectCloudflare, installChat, uninstallChat } from "@/lib/cloudflare/service";
import { findTool, installWidget, removeWidget, TOOL_NAME } from "@/lib/cloudflare/zaraz";

/** A tiny fake of the Cloudflare API: zones, token verify and the Zaraz config with publish. */
function fakeCloudflare(opts: { zarazStatus?: number; ignoreWrites?: boolean } = {}) {
  const state = {
    config: {
      zarazVersion: 5,
      dataLayer: true,
      debugKey: "k",
      settings: { autoInjectScript: true },
      tools: { other: { name: "Google Analytics", type: "component", component: "google-analytics" } },
      triggers: { pv: { name: "Pageview", system: "pageload", loadRules: [], excludeRules: [] } },
      variables: {},
    } as Record<string, unknown> & { tools: Record<string, Record<string, unknown>>; triggers: Record<string, unknown> },
    puts: 0,
    publishes: 0,
    calls: [] as string[],
  };
  const json = (result: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, result, errors: status < 400 ? [] : [{ code: 1, message: "denied" }], result_info: { total_pages: 1 } }), { status });
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace("https://api.cloudflare.com/client/v4", "");
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${path}`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cfut_token_value_0123456789");
    if (path === "/user/tokens/verify") return json({ status: "active" });
    if (path.startsWith("/zones?")) return json([{ id: "z1", name: "example.com", status: "active" }, { id: "z2", name: "shop.example.net", status: "active" }]);
    if (path.endsWith("/settings/zaraz/config")) {
      if (opts.zarazStatus && opts.zarazStatus >= 400) return json(null, opts.zarazStatus);
      if (method === "GET") return json(structuredClone(state.config));
      state.puts++;
      if (!opts.ignoreWrites) state.config = JSON.parse(String(init?.body));
      return json(state.config);
    }
    if (path.endsWith("/settings/zaraz/publish")) {
      state.publishes++;
      return json("ok");
    }
    return json(null, 404);
  });
  return { state, impl: impl as unknown as typeof fetch };
}

const TOKEN = "cfut_token_value_0123456789";
const HTML = '<script src="https://app.test/widget.js" data-key="KEY123" async></script>';

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.test";
  db.widget.allowedDomains = ["example.org"];
  db.installs.clear();
  db.conn = null;
});

describe("Zaraz install", () => {
  it("adds one tool, keeps the others and publishes", async () => {
    const { state, impl } = fakeCloudflare();
    const r = await installWidget(TOKEN, "z1", HTML, "KEY123", impl);
    expect(r.changed).toBe(true);
    expect(Object.keys(state.config.tools)).toHaveLength(2);
    expect(state.config.tools.other).toBeDefined();
    expect(state.config.zarazVersion).toBe(5);
    expect(state.config.settings).toEqual({ autoInjectScript: true });
    const tool = findTool(state.config as never, "KEY123")![1];
    expect(tool.name).toBe(`${TOOL_NAME} (KEY123)`);
    expect(JSON.stringify(tool)).toContain("widget.js");
    expect(Object.keys(state.config.triggers)).toEqual(["pv"]); // reused the existing pageview trigger
    expect(state.publishes).toBe(1);
  });

  it("is idempotent: a second install changes nothing and writes nothing", async () => {
    const { state, impl } = fakeCloudflare();
    const first = await installWidget(TOKEN, "z1", HTML, "KEY123", impl);
    const again = await installWidget(TOKEN, "z1", HTML, "KEY123", impl);
    expect(again).toEqual({ toolId: first.toolId, changed: false });
    expect(Object.keys(state.config.tools)).toHaveLength(2);
    expect(state.puts).toBe(1);
    expect(state.publishes).toBe(1);
  });

  it("updates the tool in place when the snippet changes (no second tool)", async () => {
    const { state, impl } = fakeCloudflare();
    const first = await installWidget(TOKEN, "z1", HTML, "KEY123", impl);
    const next = await installWidget(TOKEN, "z1", HTML.replace("KEY123", "NEWKEY"), "KEY123", impl);
    expect(next).toEqual({ toolId: first.toolId, changed: true });
    expect(Object.keys(state.config.tools)).toHaveLength(2);
    expect(JSON.stringify(state.config.tools[first.toolId])).toContain("NEWKEY");
  });

  it("removes only its own tool, and removing twice is harmless", async () => {
    const { state, impl } = fakeCloudflare();
    await installWidget(TOKEN, "z1", HTML, "KEY123", impl);
    expect(await removeWidget(TOKEN, "z1", "KEY123", impl)).toEqual({ changed: true });
    expect(Object.keys(state.config.tools)).toEqual(["other"]);
    expect(await removeWidget(TOKEN, "z1", "KEY123", impl)).toEqual({ changed: false });
  });
});

describe("Zaraz safety (L8)", () => {
  it("reads the config back after an update too, and fails if Cloudflare did not keep it", async () => {
    const good = fakeCloudflare();
    await installWidget(TOKEN, "z1", HTML, "KEY123", good.impl);
    const { state, impl } = fakeCloudflare({ ignoreWrites: true });
    state.config.tools.bpold = { name: `${TOOL_NAME} (KEY123)`, enabled: true, actions: { a1: { data: { htmlCode: "<old/>" } } } } as never;
    await expect(installWidget(TOKEN, "z1", HTML, "KEY123", impl)).rejects.toThrow(/did not keep it/);
    const fresh = fakeCloudflare({ ignoreWrites: true });
    await expect(installWidget(TOKEN, "z1", HTML, "KEY123", fresh.impl)).rejects.toThrow(/did not keep it/);
  });

  it("two businesses on one zone each get their own tool, and neither can take over or remove the other's", async () => {
    const { state, impl } = fakeCloudflare();
    const htmlB = HTML.replace("KEY123", "OTHERKEY");
    const a = await installWidget(TOKEN, "z1", HTML, "KEY123", impl);
    const b = await installWidget(TOKEN, "z1", htmlB, "OTHERKEY", impl);
    expect(a.toolId).not.toBe(b.toolId);
    expect(Object.keys(state.config.tools)).toHaveLength(3);
    expect(JSON.stringify(state.config.tools[a.toolId])).toContain("KEY123");
    expect(await removeWidget(TOKEN, "z1", "KEY123", impl)).toEqual({ changed: true });
    expect(Object.keys(state.config.tools).sort()).toEqual(["other", b.toolId].sort());
    expect(await removeWidget(TOKEN, "z1", "KEY123", impl)).toEqual({ changed: false });
    expect(JSON.stringify(state.config.tools[b.toolId])).toContain("OTHERKEY");
  });
});

describe("Cloudflare client", () => {
  it("verifies the token and never puts it anywhere but the Authorization header", async () => {
    const { state, impl } = fakeCloudflare();
    expect(await verifyToken(TOKEN, impl)).toBe(true);
    expect(state.calls).toEqual(["GET /user/tokens/verify"]);
  });
  it("turns 401 into a readable, auth-flagged error", async () => {
    const { impl } = fakeCloudflare({ zarazStatus: 403 });
    await expect(cf(TOKEN, "/zones/z1/settings/zaraz/config", {}, impl)).rejects.toMatchObject({ authFailed: true, message: expect.stringContaining("token") });
  });
  it("pre-fills the token page with zone read and zaraz edit", () => {
    const url = new URL(tokenPageUrl());
    expect(url.origin + url.pathname).toBe("https://dash.cloudflare.com/profile/api-tokens");
    expect(JSON.parse(url.searchParams.get("permissionGroupKeys")!)).toEqual([{ key: "zone", type: "read" }, { key: "zaraz", type: "edit" }]);
  });
});

describe("service", () => {
  async function connected(fake: ReturnType<typeof fakeCloudflare>) {
    vi.stubGlobal("fetch", fake.impl);
    await connectCloudflare("b1", TOKEN);
  }

  it("stores the token encrypted, not in the clear", async () => {
    await connected(fakeCloudflare());
    expect(db.conn!.tokenEncrypted).toMatch(/^v1:/);
    expect(db.conn!.tokenEncrypted).not.toContain(TOKEN);
    vi.unstubAllGlobals();
  });

  it("rejects an obviously wrong token without calling Cloudflare", async () => {
    const fake = fakeCloudflare();
    vi.stubGlobal("fetch", fake.impl);
    await expect(connectCloudflare("b1", "short")).rejects.toThrow(/API token/);
    expect(fake.state.calls).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("install adds the domain to the allowed websites once and records the install; repeating changes nothing", async () => {
    const fake = fakeCloudflare();
    await connected(fake);
    expect(await installChat("b1", "z1")).toEqual({ status: "installed" });
    expect(await installChat("b1", "z1")).toEqual({ status: "already_installed" });
    expect(db.widget.allowedDomains).toEqual(["example.org", "example.com"]);
    expect(db.installs.size).toBe(1);
    expect(Object.keys(fake.state.config.tools)).toHaveLength(2);
    expect(fake.state.puts).toBe(1);
    await uninstallChat("b1", "z1");
    expect(db.installs.size).toBe(0);
    expect(Object.keys(fake.state.config.tools)).toEqual(["other"]);
    vi.unstubAllGlobals();
  });

  it("does not add a subdomain that an allowed domain already covers", async () => {
    db.widget.allowedDomains = ["example.net"];
    await allowDomain("b1", "shop.example.net");
    expect(db.widget.allowedDomains).toEqual(["example.net"]);
  });

  it("falls back to the manual step when Cloudflare refuses (token lacks Zaraz), leaving the site untouched", async () => {
    const fake = fakeCloudflare({ zarazStatus: 403 });
    await connected(fake);
    const r = await installChat("b1", "z1");
    expect(r).toMatchObject({ status: "manual", reason: expect.stringContaining("Zaraz") });
    expect(db.installs.size).toBe(0);
    expect(fake.state.puts).toBe(0);
    vi.unstubAllGlobals();
  });

  it("refuses a zone that is not in the account", async () => {
    await connected(fakeCloudflare());
    await expect(installChat("b1", "not-mine")).rejects.toThrow(/could not find/);
    vi.unstubAllGlobals();
  });
});
