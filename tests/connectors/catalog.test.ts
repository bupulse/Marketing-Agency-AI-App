import { describe, expect, it, vi } from "vitest";

// The real entries pull in provider code; the catalog only needs the type.
vi.mock("@/lib/connectors/entries/google-drive", () => ({ connector: { id: "stub" } }));
vi.mock("@/lib/connectors/entries/dropbox", () => ({ connector: { id: "stub" } }));
vi.mock("@/lib/connectors/entries/canva", () => ({ connector: { id: "stub" } }));
vi.mock("@/lib/connectors/entries/shopify", () => ({ connector: { id: "stub" } }));
vi.mock("@/lib/connectors/entries/woocommerce", () => ({ connector: { id: "stub" } }));
vi.mock("@/lib/connectors/entries/cloudflare", () => ({ connector: { id: "stub" } }));

import { getCatalog, PLANNED } from "@/lib/connectors/catalog";
import type { ConnectorEntry } from "@/lib/connectors/types";

const ctx = { userId: "u1", businessId: "b1" };
const entry = (id: ConnectorEntry["id"], status: ConnectorEntry["status"]): ConnectorEntry => ({
  id,
  name: `Name ${id}`,
  group: PLANNED[id].group,
  description: "d",
  icon: "plug",
  status,
  connectHref: `/api/${id}/start`,
  manageHref: `/dashboard/${id}`,
  disconnect: async () => {},
});

describe("getCatalog", () => {
  it("collects every status in parallel and keeps going when one entry fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const started: string[] = [];
    const slow = (id: string, status: Awaited<ReturnType<ConnectorEntry["status"]>>) => async () => {
      started.push(id);
      await new Promise((r) => setTimeout(r, 20));
      return status;
    };
    const items = await getCatalog(ctx, [
      entry("shopify", slow("shopify", { state: "connected", accountLabel: "shop.myshopify.com", detail: "Last synced 5 minutes ago" })),
      entry("dropbox", async () => {
        throw new Error("database down");
      }),
      entry("canva", slow("canva", { state: "not_connected" })),
    ]);
    expect(started.sort()).toEqual(["canva", "shopify"]);
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.shopify.status).toEqual({ state: "connected", accountLabel: "shop.myshopify.com", detail: "Last synced 5 minutes ago" });
    expect(by.shopify.manageHref).toBe("/dashboard/shopify");
    expect(by.dropbox.status.state).toBe("needs_attention"); // the failing one only
    expect(by.dropbox.status.detail).toMatch(/could not check/i);
    expect(by.canva.status.state).toBe("not_connected");
  });

  it("shows every planned connector, as coming soon when it has no entry", async () => {
    const items = await getCatalog(ctx, [entry("canva", async () => ({ state: "connected" }))]);
    expect(items.map((i) => i.id).sort()).toEqual(["canva", "cloudflare", "dropbox", "google-drive", "shopify", "woocommerce"]);
    const soon = items.filter((i) => i.id !== "canva");
    expect(soon.every((i) => i.status.state === "unavailable" && i.connectHref === null)).toBe(true);
  });

  it("passes the user and business to each status call", async () => {
    const status = vi.fn(async () => ({ state: "not_connected" as const }));
    await getCatalog(ctx, [entry("canva", status)]);
    expect(status).toHaveBeenCalledWith(ctx);
  });
});
