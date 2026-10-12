import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: async () => {
      if (db.fail) throw new Error("connection refused");
      return [{ "?column?": 1 }];
    },
  },
}));

import { whatsappDigits, whatsappLink } from "@/lib/content/contact";
import { paymentBadges } from "@/lib/region-format";

describe("WhatsApp link", () => {
  it("keeps only the digits of an international number", () => {
    expect(whatsappDigits("+250 791 954 277")).toBe("250791954277");
    expect(whatsappLink("+250 791 954 277")).toBe("https://wa.me/250791954277");
  });
  it("encodes a prefilled message", () => {
    expect(whatsappLink("+250791954277", "Hello BuPulse & team")).toBe("https://wa.me/250791954277?text=Hello%20BuPulse%20%26%20team");
  });
  it("is null when the number is missing or not a phone number", () => {
    expect(whatsappLink(undefined)).toBeNull();
    expect(whatsappLink("")).toBeNull();
    expect(whatsappLink("12345")).toBeNull();
    expect(whatsappLink("1".repeat(16))).toBeNull();
  });
});

describe("payment badges", () => {
  it("names MTN MoMo and Airtel Money for Mobile Money, then card", () => {
    expect(paymentBadges(["momo", "card"])).toEqual(["MTN MoMo", "Airtel Money", "Card"]);
  });
  it("shows only card where Mobile Money isn't offered, and ignores unknown methods", () => {
    expect(paymentBadges(["card", "cash"])).toEqual(["Card"]);
    expect(paymentBadges([])).toEqual([]);
  });
});

describe("GET /api/status", () => {
  beforeEach(() => {
    db.fail = false;
  });

  it("is ok with the database reachable, and never cached", async () => {
    const { GET } = await import("@/app/api/status/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", database: "ok" });
    expect(Object.keys(body).sort()).toEqual(["database", "databaseMs", "status", "time", "version"]);
  });

  it("answers 503 when the database fails", async () => {
    db.fail = true;
    const { GET } = await import("@/app/api/status/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "down", database: "down" });
  });
});
