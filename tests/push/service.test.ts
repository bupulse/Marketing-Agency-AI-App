import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  pushSubscription: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  membership: { findMany: vi.fn() },
}));
const logError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError }));

import { allowedEndpoint, MAX_DEVICES_PER_PERSON, pushPublicKey, pushToLeadWatchers, saveDevice } from "@/lib/push/service";
import { base64UrlEncode } from "@/lib/push/web-push";

const b64 = (b: Buffer) => base64UrlEncode(b);
function keyPair() {
  const e = crypto.createECDH("prime256v1");
  e.generateKeys();
  return e;
}
const server = keyPair();
function device(id: string, userId: string, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`) {
  return { id, userId, endpoint, p256dh: b64(keyPair().getPublicKey()), auth: b64(crypto.randomBytes(16)) };
}
const member = (userId: string, role: "OWNER" | "ADMIN" | "MEMBER", user: { suspendedAt?: Date | null; deletionScheduledFor?: Date | null } = {}) => ({ userId, role, user: { suspendedAt: null, deletionScheduledFor: null, ...user } });
const message = { title: "New lead: Jane", body: "Do you have the A15?", url: "https://bupulse.com/dashboard/leads/l1", tag: "lead-l1" };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VAPID_PUBLIC_KEY = b64(server.getPublicKey());
  process.env.VAPID_PRIVATE_KEY = b64(server.getPrivateKey());
  process.env.VAPID_SUBJECT = "mailto:office@bupulse.com";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => new Response(null, { status: 201 }));
  prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
  prisma.pushSubscription.updateMany.mockResolvedValue({ count: 0 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe("push setup", () => {
  it("is off without the three VAPID values, and with a malformed key", async () => {
    expect(pushPublicKey()).toBe(process.env.VAPID_PUBLIC_KEY);
    delete process.env.VAPID_SUBJECT;
    expect(pushPublicKey()).toBeNull();
    expect(await pushToLeadWatchers("b1", message)).toBe(0);
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    process.env.VAPID_SUBJECT = "mailto:office@bupulse.com";
    process.env.VAPID_PRIVATE_KEY = "not-a-key";
    expect(pushPublicKey()).toBeNull();
  });

  it("only saves endpoints of the browsers' push services (local ones outside production)", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QF", "https://wns2-par02p.notify.windows.com/w/?token=x"]) expect(allowedEndpoint(ok, true), ok).toBe(true);
    for (const bad of ["https://evil.example.com/push", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com:8443/x", "https://fcm.googleapis.com.evil.com/x", "http://localhost:3199/push", "not a url"]) expect(allowedEndpoint(bad, true), bad).toBe(false);
    expect(allowedEndpoint("http://localhost:3199/push", false)).toBe(true);
    expect(allowedEndpoint("http://10.0.0.5/push", false)).toBe(false);
  });
});

describe("saveDevice", () => {
  it("keeps one row per browser, owned by the latest person, and at most MAX_DEVICES_PER_PERSON per person", async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([{ id: "old1" }]);
    await saveDevice("b1", "u1", { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p", auth: "a" }, device: "Chrome on Android" });
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: "https://fcm.googleapis.com/fcm/send/x" },
      create: { endpoint: "https://fcm.googleapis.com/fcm/send/x", businessId: "b1", userId: "u1", p256dh: "p", auth: "a", device: "Chrome on Android" },
      update: { businessId: "b1", userId: "u1", p256dh: "p", auth: "a", device: "Chrome on Android" },
    });
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" }, skip: MAX_DEVICES_PER_PERSON }));
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old1"] } } });
  });
});

describe("pushToLeadWatchers", () => {
  it("sends to the devices of live members who may see leads, side by side", async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([device("d1", "owner"), device("d2", "member"), device("d3", "left-team"), device("d4", "suspended"), device("d5", "owner", "https://evil.example.com/x")]);
    prisma.membership.findMany.mockResolvedValue([member("owner", "OWNER"), member("member", "MEMBER"), member("suspended", "ADMIN", { suspendedAt: new Date() })]);
    expect(await pushToLeadWatchers("b1", message)).toBe(2);
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(["https://fcm.googleapis.com/fcm/send/d1", "https://fcm.googleapis.com/fcm/send/d2"]);
    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "b1" } }));
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["d1", "d2"] } }, data: { lastSentAt: expect.any(Date) } });
  });

  it("removes devices the push service no longer knows and keeps (and logs) other refusals", async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([device("gone410", "owner"), device("gone404", "owner"), device("busy", "owner"), device("ok", "owner")]);
    prisma.membership.findMany.mockResolvedValue([member("owner", "OWNER")]);
    fetchMock.mockImplementation(async (url: string) => new Response(null, { status: url.endsWith("gone410") ? 410 : url.endsWith("gone404") ? 404 : url.endsWith("busy") ? 503 : 201 }));
    expect(await pushToLeadWatchers("b1", message)).toBe(1);
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["gone410", "gone404"] } } });
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("503") }), expect.objectContaining({ source: "push.send", businessId: "b1" }));
  });

  it("never throws: a network failure on one device leaves the others", async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([device("down", "owner"), device("ok", "owner")]);
    prisma.membership.findMany.mockResolvedValue([member("owner", "OWNER")]);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("down")) throw new TypeError("fetch failed");
      return new Response(null, { status: 201 });
    });
    expect(await pushToLeadWatchers("b1", message)).toBe(1);
    prisma.pushSubscription.findMany.mockRejectedValue(new Error("db down"));
    expect(await pushToLeadWatchers("b1", message)).toBe(0);
  });
});
