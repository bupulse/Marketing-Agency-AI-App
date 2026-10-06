import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatMoney, mapStatus, mapSubscription, parseSignatureHeader, verifySignature } from "@/lib/billing/paddle-map";

const USER = "11111111-1111-4111-8111-111111111111";

const base = {
  id: "sub_1",
  status: "active",
  customer_id: "ctm_1",
  items: [{ price: { id: "pri_1" } }],
  custom_data: { userId: USER },
  current_billing_period: { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" },
  scheduled_change: null,
};

describe("mapStatus", () => {
  it.each([
    ["active", "ACTIVE"],
    ["trialing", "TRIALING"],
    ["past_due", "PAST_DUE"],
    ["paused", "PAST_DUE"],
    ["canceled", "CANCELED"],
    ["weird", null],
  ])("%s -> %s", (input, expected) => expect(mapStatus(input)).toBe(expected));
});

describe("mapSubscription", () => {
  it("maps an active subscription", () => {
    expect(mapSubscription({ ...base, updated_at: "2026-10-01T00:05:00Z" })).toEqual({
      providerSubscriptionId: "sub_1",
      providerCustomerId: "ctm_1",
      providerPriceId: "pri_1",
      userId: USER,
      status: "ACTIVE",
      currentPeriodStart: new Date("2026-10-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
      updatedAt: new Date("2026-10-01T00:05:00Z"),
    });
  });

  it("flags cancel at period end", () => {
    const sub = mapSubscription({ ...base, scheduled_change: { action: "cancel", effective_at: "2026-11-01T00:00:00Z" } });
    expect(sub?.cancelAtPeriodEnd).toBe(true);
    expect(sub?.status).toBe("ACTIVE");
  });

  it("does not treat a scheduled pause as a cancel", () => {
    expect(mapSubscription({ ...base, scheduled_change: { action: "pause", effective_at: "2026-11-01T00:00:00Z" } })?.cancelAtPeriodEnd).toBe(false);
  });

  it("ignores a user id that is not a UUID", () => {
    expect(mapSubscription({ ...base, custom_data: { userId: "nope" } })?.userId).toBeNull();
    expect(mapSubscription({ ...base, custom_data: null })?.userId).toBeNull();
  });

  it("falls back to cancellation dates when there is no billing period", () => {
    const sub = mapSubscription({
      ...base,
      status: "canceled",
      current_billing_period: null,
      started_at: "2026-09-01T00:00:00Z",
      canceled_at: "2026-10-05T00:00:00Z",
    });
    expect(sub?.status).toBe("CANCELED");
    expect(sub?.currentPeriodStart).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(sub?.currentPeriodEnd).toEqual(new Date("2026-10-05T00:00:00Z"));
  });

  it.each([null, {}, { ...base, items: [] }, { ...base, status: "x" }])("returns null for unusable data", (data) => {
    expect(mapSubscription(data)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats lowest-denomination strings", () => {
    expect(formatMoney("4900", "USD")).toBe("$49.00");
    expect(formatMoney("99000", "USD")).toBe("$990.00");
    expect(formatMoney("5000", "JPY")).toBe("¥5,000");
  });
  it("falls back on a bad currency", () => expect(formatMoney("100", "??")).toBe("100 ??"));
});

describe("signatures", () => {
  const secret = "pdl_ntfset_test";
  const body = '{"a":1}';
  const now = 1_800_000_000_000;
  const sign = (ts: number, text = body) => createHmac("sha256", secret).update(`${ts}:${text}`).digest("hex");

  it("parses the header with several h1 values", () => {
    expect(parseSignatureHeader("ts=10;h1=AA;h1=bb")).toEqual({ ts: 10, signatures: ["aa", "bb"] });
    expect(parseSignatureHeader("h1=aa")).toBeNull();
    expect(parseSignatureHeader(null)).toBeNull();
  });

  it("accepts a valid signature, also during secret rotation", async () => {
    const ts = now / 1000;
    expect(await verifySignature(body, `ts=${ts};h1=${sign(ts)}`, secret, now)).toBe(true);
    expect(await verifySignature(body, `ts=${ts};h1=${"0".repeat(64)};h1=${sign(ts)}`, secret, now)).toBe(true);
  });

  it("rejects a tampered body, wrong secret, garbage and stale timestamps", async () => {
    const ts = now / 1000;
    expect(await verifySignature('{"a":2}', `ts=${ts};h1=${sign(ts)}`, secret, now)).toBe(false);
    expect(await verifySignature(body, `ts=${ts};h1=${sign(ts)}`, "other", now)).toBe(false);
    expect(await verifySignature(body, `ts=${ts};h1=zz`, secret, now)).toBe(false);
    const old = ts - 6 * 60;
    expect(await verifySignature(body, `ts=${old};h1=${sign(old)}`, secret, now)).toBe(false);
  });
});
