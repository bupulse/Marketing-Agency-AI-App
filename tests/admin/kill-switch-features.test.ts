import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Each feature that uses an outside service stops gracefully when the service is switched off in the admin console,
// without losing data: posts stay SCHEDULED, leads are still collected, stored products and connections are untouched.

const h = vi.hoisted(() => ({
  off: [] as string[],
  queryRaw: vi.fn(async () => [] as unknown[]),
  storeFindMany: vi.fn(async () => [] as unknown[]),
  storeCount: vi.fn(async () => 0),
  canvaCount: vi.fn(async () => 0),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    serviceSwitch: { findMany: vi.fn(async () => h.off.map((service) => ({ service }))) },
    $queryRaw: h.queryRaw,
    storeConnection: { findMany: h.storeFindMany, count: h.storeCount, updateMany: vi.fn() },
    canvaConnection: { count: h.canvaCount },
  },
}));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { claimDuePosts } from "@/lib/publishing/engine";
import { importDriveFile, importDropboxFile, importCanvaDesign, listCanvaDesigns, importOptions } from "@/lib/media/importers";
import { MediaError } from "@/lib/media/service";
import { getCatalog } from "@/lib/connectors/catalog";
import type { ConnectorEntry } from "@/lib/connectors/types";
import { runDailyStoreSync } from "@/lib/stores/sync";
import { installChat, connectCloudflare, CloudflareUserError } from "@/lib/cloudflare/service";
import { clearSwitchCache, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";

beforeEach(() => {
  vi.clearAllMocks();
  h.off = [];
  clearSwitchCache();
  process.env.GOOGLE_PICKER_API_KEY = "k";
  process.env.GOOGLE_PICKER_APP_ID = "a";
  process.env.GOOGLE_CLIENT_ID = "c";
  process.env.DROPBOX_APP_KEY = "d";
});
const turnOff = (...ids: string[]) => {
  h.off = ids;
  clearSwitchCache();
};

describe("publishing", () => {
  // $queryRaw`...${fragment}...` receives (strings, ...values); Prisma.sql fragments carry their own .sql and .values.
  const sqlOf = () => {
    const [strings, ...exprs] = h.queryRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
    let sql = strings.join("?");
    const values: unknown[] = [];
    for (const e of exprs) {
      if (e && typeof e === "object" && "sql" in e && "values" in e) {
        sql += ` ${(e as { sql: string }).sql}`;
        values.push(...(e as { values: unknown[] }).values);
      } else values.push(e);
    }
    return { sql, values };
  };

  it("claims posts of every network while nothing is off", async () => {
    await claimDuePosts({ now: new Date(), limit: 5 });
    expect(sqlOf().sql).not.toMatch(/"network" NOT IN/);
  });

  it("leaves the posts of a switched-off network unclaimed (they stay SCHEDULED, not failed)", async () => {
    turnOff("meta", "tiktok");
    await claimDuePosts({ now: new Date(), limit: 5 });
    expect(sqlOf().sql).toMatch(/"network" NOT IN/);
    expect(sqlOf().values).toEqual(expect.arrayContaining(["facebook", "instagram", "tiktok"]));
    expect(sqlOf().values).not.toContain("linkedin");
    expect(sqlOf().sql).not.toMatch(/FAILED/); // it only skips; it never writes a failure
  });
});

describe("importers", () => {
  const ctx = { userId: "u1", businessId: "b1" } as never;

  it("refuse with the friendly message while their service is off", async () => {
    turnOff("google-drive", "dropbox", "canva");
    for (const run of [
      () => importDriveFile(ctx, { token: "t", fileId: "abcdefghij1", folderId: null }),
      () => importDropboxFile(ctx, { link: "https://dl.dropboxusercontent.com/x", name: "a.jpg", folderId: null }),
      () => importCanvaDesign(ctx, { designId: "D1", title: "t", folderId: null }),
      () => listCanvaDesigns("u1", {}),
    ]) {
      const err = await run().catch((e) => e);
      expect(err).toBeInstanceOf(MediaError);
      expect(err.message).toBe(UNAVAILABLE_MESSAGE);
    }
  });

  it("hide a switched-off source in the import menu and keep the others", async () => {
    turnOff("dropbox", "canva");
    const options = await importOptions("u1");
    expect(options.dropboxAppKey).toBeNull();
    expect(options.canva).toBe("unavailable");
    expect(options.google).not.toBeNull();
    turnOff();
    expect((await importOptions("u1")).dropboxAppKey).toBe("d");
  });
});

describe("connectors catalog", () => {
  it("shows a switched-off connector as unavailable, without calling it, and the others as usual", async () => {
    const status = vi.fn(async () => ({ state: "connected" as const }));
    const entry = (id: ConnectorEntry["id"]): ConnectorEntry => ({ id, name: id, group: "store", description: "d", icon: "x", status, connectHref: "/c", disconnect: async () => {} });
    turnOff("shopify");
    const items = await getCatalog({ userId: "u", businessId: "b" }, [entry("shopify"), entry("woocommerce")]);
    const shop = items.find((i) => i.id === "shopify")!;
    expect(shop.status.state).toBe("unavailable");
    expect(shop.status.detail).toMatch(/temporarily unavailable/i);
    expect(shop.connectHref).toBeNull();
    expect(items.find((i) => i.id === "woocommerce")!.status.state).toBe("connected");
    expect(status).toHaveBeenCalledTimes(1);
  });
});

describe("store sync", () => {
  it("the daily sync skips stores of a switched-off provider and touches nothing else", async () => {
    turnOff("shopify");
    await runDailyStoreSync({ now: new Date("2026-10-09T03:00:00Z") });
    const where = (h.storeFindMany.mock.calls[0] as unknown as [{ where: { provider?: { notIn: string[] } } }])[0].where;
    expect(where.provider).toEqual({ notIn: ["shopify"] });
    turnOff();
    await runDailyStoreSync({ now: new Date("2026-10-09T03:00:00Z") });
    expect((h.storeFindMany.mock.calls[1] as unknown as [{ where: object }])[0].where).not.toHaveProperty("provider");
  });
});

describe("Cloudflare", () => {
  it("connect says unavailable and install falls back to the copy-paste code", async () => {
    turnOff("cloudflare");
    await expect(connectCloudflare("b1", "x".repeat(40))).rejects.toBeInstanceOf(CloudflareUserError);
    await expect(connectCloudflare("b1", "x".repeat(40))).rejects.toThrow(/temporarily unavailable/i);
    const out = await installChat("b1", "zone1");
    expect(out.status).toBe("manual");
    expect((out as { reason: string }).reason).toMatch(/temporarily unavailable/i);
  });
});

describe("Paddle", () => {
  it("the webhook route never looks at the switch, so payment events keep arriving", () => {
    const route = readFileSync("app/api/billing/webhooks/paddle/route.ts", "utf8");
    expect(route).not.toMatch(/admin\/switch|isServiceEnabled|assertServiceEnabled/);
  });

  it("only new checkouts, plan changes and admin money actions check the switch", () => {
    expect(readFileSync("app/dashboard/billing/actions.ts", "utf8")).toMatch(/isServiceEnabled\("paddle"\)/);
    const service = readFileSync("lib/admin/service.ts", "utf8");
    expect(service).toMatch(/requirePaddleOn\(\)/);
    expect(service.match(/requirePaddleOn\(\)/g)!.length).toBeGreaterThanOrEqual(4); // refund, paid change, approve + the helper itself
  });
});
