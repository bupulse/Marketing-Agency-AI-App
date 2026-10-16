import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  lead: { findUnique: vi.fn() },
  chatWidget: { findUnique: vi.fn() },
  serviceSwitch: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
}));
const sendEmail = vi.hoisted(() => vi.fn(async () => true));
const pushToLeadWatchers = vi.hoisted(() => vi.fn(async () => 1));
const emitWebhookEvent = vi.hoisted(() => vi.fn(async () => 0));
const logError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail }));
vi.mock("@/lib/push/service", () => ({ pushToLeadWatchers }));
vi.mock("@/lib/webhooks/emit", () => ({ emitWebhookEvent }));
vi.mock("@/lib/team/recipients", () => ({ alertRecipients: vi.fn(async (_b: string, fallback: string) => [fallback]) }));
vi.mock("@/lib/auth/request-site", () => ({ linkSiteUrl: vi.fn(async () => "https://bupulse.com") }));

import { clearSwitchCache, isServiceEnabled } from "@/lib/admin/switch";
import { renderInstantLeadEmail } from "@/lib/leads/email";
import { notifyNewLead, pushText } from "@/lib/leads/notify";
import { sendWhatsappLeadAlert, templateMessage, whatsappAlertsAvailable, whatsappRecipient } from "@/lib/leads/whatsapp";

const fetchMock = vi.fn();
const lead = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  name: "Jane Uwase",
  email: "jane@example.com",
  phone: "+250 788 123 456",
  interest: null,
  message: "Do you have the Galaxy A15 in blue?",
  source: "website_chat",
  status: "NEW",
  pageUrl: null,
  createdAt: new Date("2026-10-14T10:00:00Z"),
  business: { id: "b1", name: "Nova Phones Kigali", phone: "+250 791 000 111", user: { email: "owner@nova.rw", deletionScheduledFor: null, suspendedAt: null } },
  session: null,
  ...over,
});
const whatsappOn = () => prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "whatsapp", enabled: true }]);
const graphCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("https://graph.facebook.com/"));

beforeEach(() => {
  vi.clearAllMocks();
  clearSwitchCache();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
  prisma.lead.findUnique.mockResolvedValue(lead());
  prisma.chatWidget.findUnique.mockResolvedValue({ notifyInstant: true, notifyWhatsapp: true, whatsappNumber: null });
  prisma.serviceSwitch.findMany.mockResolvedValue([]);
  prisma.$executeRaw.mockResolvedValue(1);
  process.env.WHATSAPP_CLOUD_TOKEN = "EAAG-test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHATSAPP_CLOUD_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

describe("push alerts for a new lead", () => {
  it("sends 'New lead: <name>' with the first message, opening the lead in BuPulse", async () => {
    const result = await notifyNewLead("l1");
    expect(pushToLeadWatchers).toHaveBeenCalledWith("b1", { title: "New lead: Jane Uwase", body: "Do you have the Galaxy A15 in blue?", url: "https://bupulse.com/dashboard/leads/l1", tag: "lead-l1" });
    expect(result).toMatchObject({ emailed: true, pushed: 1 });
  });

  it("falls back to the phone when the visitor wrote nothing", () => {
    expect(pushText({ name: null, email: null, phone: "+250788123456", message: null, interest: null }, [])).toEqual({ title: "New lead: +250788123456", body: "+250788123456" });
    expect(pushText({ name: "Ana", email: null, phone: null, message: null, interest: null }, [{ role: "assistant", content: "Hi!" }, { role: "visitor", content: "Price of the A15?" }]).body).toBe("Price of the A15?");
  });

  it("never blocks the email: a slow push does not hold it, a failing one does not stop it", async () => {
    let release = () => {};
    pushToLeadWatchers.mockImplementationOnce(() => new Promise<number>((resolve) => (release = () => resolve(1))));
    const pending = notifyNewLead("l1");
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    release();
    await pending;

    pushToLeadWatchers.mockRejectedValueOnce(new Error("push service down"));
    expect(await notifyNewLead("l1")).toMatchObject({ emailed: true, pushed: 0 });
  });

  it("sends nothing to a suspended company", async () => {
    prisma.lead.findUnique.mockResolvedValue(lead({ business: { ...lead().business, user: { email: "o@x.rw", deletionScheduledFor: null, suspendedAt: new Date() } } }));
    whatsappOn();
    expect(await notifyNewLead("l1")).toMatchObject({ emailed: false, pushed: 0, whatsapp: false });
    expect(pushToLeadWatchers).not.toHaveBeenCalled();
    expect(graphCalls()).toHaveLength(0);
  });
});

describe("WhatsApp alerts (built, off by default)", () => {
  it("are off until the admin switches the service on, even with the keys set", async () => {
    expect(await isServiceEnabled("whatsapp")).toBe(false);
    expect(await whatsappAlertsAvailable()).toBe(false);
    expect(await notifyNewLead("l1")).toMatchObject({ emailed: true, whatsapp: false });
    expect(graphCalls()).toHaveLength(0);
  });

  it("are off without the keys, even when switched on", async () => {
    whatsappOn();
    delete process.env.WHATSAPP_CLOUD_TOKEN;
    expect(await whatsappAlertsAvailable()).toBe(false);
    expect((await notifyNewLead("l1")).whatsapp).toBe(false);
    expect(graphCalls()).toHaveLength(0);
  });

  it("send the approved template to the owner's number when the service and the owner's toggle are on, and count it", async () => {
    whatsappOn();
    expect(await whatsappAlertsAvailable()).toBe(true);
    expect((await notifyNewLead("l1")).whatsapp).toBe(true);
    const [[url, init]] = graphCalls() as [string, RequestInit & { headers: Record<string, string> }][];
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect(init.headers.Authorization).toBe("Bearer EAAG-test-token");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "250791000111", type: "template", template: { name: "new_lead_alert", language: { code: "en" } } });
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["Nova Phones Kigali", "Jane Uwase", "Do you have the Galaxy A15 in blue?"]);
    expect(body.template.components[1]).toEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "l1" }] });
    const counted = prisma.$executeRaw.mock.calls.map((c) => (c as unknown[]).slice(1));
    expect(counted[0]).toEqual(expect.arrayContaining(["whatsapp", 1, 0]));
  });

  it("use the WhatsApp number for alerts when one is set, and nothing when the owner turned them off", async () => {
    whatsappOn();
    prisma.chatWidget.findUnique.mockResolvedValue({ notifyInstant: true, notifyWhatsapp: true, whatsappNumber: "+250722000333" });
    await notifyNewLead("l1");
    expect(JSON.parse(String((graphCalls()[0] as [string, RequestInit])[1].body)).to).toBe("250722000333");
    fetchMock.mockClear();
    prisma.chatWidget.findUnique.mockResolvedValue({ notifyInstant: true, notifyWhatsapp: false, whatsappNumber: "+250722000333" });
    expect((await notifyNewLead("l1")).whatsapp).toBe(false);
    expect(graphCalls()).toHaveLength(0);
  });

  it("log and count a refusal without throwing, and the email still goes", async () => {
    whatsappOn();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Template name does not exist in the translation", code: 132001 } }), { status: 404 }));
    expect(await notifyNewLead("l1")).toMatchObject({ emailed: true, whatsapp: false });
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("132001") }), expect.objectContaining({ source: "whatsapp.lead_alert" }));
    expect(prisma.$executeRaw.mock.calls.map((c) => (c as unknown[]).slice(1))[0]).toEqual(expect.arrayContaining(["whatsapp", 0, 1]));
  });

  it("need an international number and clean the template's text", async () => {
    expect(whatsappRecipient("+250 788-123-456")).toBe("250788123456");
    expect(whatsappRecipient("0788123456")).toBeNull();
    expect(whatsappRecipient(null)).toBeNull();
    whatsappOn();
    expect(await sendWhatsappLeadAlert({ to: "0788123456", lead: lead(), businessName: "Nova", businessId: "b1" })).toBe(false);
    const msg = templateMessage("250788123456", { ...lead(), message: "Line one\n\nline\ttwo     end" }, "Nova\nPhones", { template: "new_lead_alert", language: "en" });
    const texts = msg.template.components[0].parameters.map((p) => p.text);
    expect(texts).toEqual(["Nova Phones", "Jane Uwase", "Line one line two end"]);
    expect(texts.join("")).not.toMatch(/[\n\t]| {5}/);
  });
});

describe("the instant lead email", () => {
  it("has a Reply on WhatsApp button only when the lead left a phone number", () => {
    const withPhone = renderInstantLeadEmail({ lead: lead(), businessName: "Nova Phones Kigali", transcript: [] });
    expect(withPhone.html).toContain('href="https://wa.me/250788123456"');
    expect(withPhone.html).toContain("Reply on WhatsApp");
    expect(withPhone.text).toContain("Reply on WhatsApp: https://wa.me/250788123456");
    expect(withPhone.html).toContain("Open in BuPulse");
    const noPhone = renderInstantLeadEmail({ lead: lead({ phone: null }), businessName: "Nova Phones Kigali", transcript: [] });
    expect(noPhone.html).not.toContain("WhatsApp");
    expect(noPhone.text).not.toContain("WhatsApp");
  });
});
