import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const h = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "ADMIN" | "MEMBER" }));
const prisma = vi.hoisted(() => ({ business: { findUnique: vi.fn(async () => ({ id: "b1" })) } }));
const push = vi.hoisted(() => ({ saveDevice: vi.fn(async () => {}), removeDevice: vi.fn(async () => {}) }));
const wa = vi.hoisted(() => ({ available: vi.fn(async () => false), save: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/push/service", async (orig) => ({ ...(await orig<typeof import("@/lib/push/service")>()), ...push }));
vi.mock("@/lib/leads/whatsapp", () => ({ whatsappAlertsAvailable: wa.available }));
vi.mock("@/lib/leads/settings", () => ({ saveEmailToggles: vi.fn(), saveWhatsappAlerts: wa.save }));
vi.mock("@/lib/auth/require-user", async () => {
  const { can, ForbiddenError } = await import("@/lib/team/roles");
  return {
    requireActiveUser: vi.fn(async (permission?: Parameters<typeof can>[1]) => {
      if (permission && !can(h.role, permission)) throw new ForbiddenError(permission);
      return { id: "owner-account", actorId: "person-1", role: h.role, businessId: "b1", email: "p@nova.rw" };
    }),
  };
});

import { removePushDevice, savePushDevice, saveWhatsappToggle } from "@/app/dashboard/leads/actions";

const ecdh = crypto.createECDH("prime256v1");
ecdh.generateKeys();
const device = (endpoint = "https://fcm.googleapis.com/fcm/send/abc:xyz") => ({
  endpoint,
  keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") },
  device: "Chrome on Android",
});

beforeEach(() => {
  vi.clearAllMocks();
  h.role = "OWNER";
  const server = crypto.createECDH("prime256v1");
  server.generateKeys();
  process.env.VAPID_PUBLIC_KEY = server.getPublicKey().toString("base64url");
  process.env.VAPID_PRIVATE_KEY = server.getPrivateKey().toString("base64url");
  process.env.VAPID_SUBJECT = "mailto:office@bupulse.com";
});
afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe("Alerts on this device", () => {
  it("saves the device for the person signed in, Members included", async () => {
    h.role = "MEMBER";
    const phone = device();
    expect(await savePushDevice(phone)).toEqual({ ok: true });
    expect(push.saveDevice).toHaveBeenCalledWith("b1", "person-1", phone);
  });

  it("refuses an endpoint that is not a browser push service, and malformed keys", async () => {
    expect(await savePushDevice(device("https://evil.example.com/collect"))).toMatchObject({ ok: false });
    expect(await savePushDevice({ ...device(), keys: { p256dh: "x", auth: "y" } })).toMatchObject({ ok: false });
    expect(push.saveDevice).not.toHaveBeenCalled();
  });

  it("is unavailable without VAPID keys", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await savePushDevice(device())).toEqual({ ok: false, error: "Phone and browser alerts are not available right now." });
  });

  it("turns a device off for that person only", async () => {
    expect(await removePushDevice("https://fcm.googleapis.com/fcm/send/abc:xyz")).toEqual({ ok: true });
    expect(push.removeDevice).toHaveBeenCalledWith("person-1", "https://fcm.googleapis.com/fcm/send/abc:xyz");
  });
});

describe("WhatsApp alerts toggle", () => {
  it("is refused while the admin does not offer WhatsApp", async () => {
    expect(await saveWhatsappToggle({ enabled: true, number: "" })).toEqual({ ok: false, error: "WhatsApp alerts are not available right now." });
    expect(wa.save).not.toHaveBeenCalled();
  });

  it("saves the toggle and an international number (empty means the business phone)", async () => {
    wa.available.mockResolvedValue(true);
    expect(await saveWhatsappToggle({ enabled: true, number: "+250 788 123 456" })).toEqual({ ok: true });
    expect(wa.save).toHaveBeenCalledWith("b1", { notifyWhatsapp: true, whatsappNumber: "+250788123456" });
    expect(await saveWhatsappToggle({ enabled: true, number: "" })).toEqual({ ok: true });
    expect(wa.save).toHaveBeenLastCalledWith("b1", { notifyWhatsapp: true, whatsappNumber: null });
    expect(await saveWhatsappToggle({ enabled: true, number: "0788 123 456" })).toMatchObject({ ok: false, error: expect.stringContaining("country code") });
  });

  it("is a settings change: Members may not make it", async () => {
    wa.available.mockResolvedValue(true);
    h.role = "MEMBER";
    expect(await saveWhatsappToggle({ enabled: true, number: "" })).toMatchObject({ ok: false });
    expect(wa.save).not.toHaveBeenCalled();
  });
});
