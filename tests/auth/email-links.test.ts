import { beforeEach, describe, expect, it, vi } from "vitest";

// Emails sent because of a click link to the site the person was on; emails sent by a scheduled job link to the
// public address (never localhost). Checked on real email builders with the mailer replaced.

const h = vi.hoisted(() => ({ headers: null as Headers | null, sent: [] as { to: string; html: string; text: string }[] }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!h.headers) throw new Error("outside a request");
    return h.headers;
  },
}));
vi.mock("@/lib/publishing/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/publishing/email")>()),
  sendEmail: async (e: { to: string; html: string; text: string }) => (h.sent.push(e), true),
}));
vi.mock("@/lib/admin/auth", () => ({ adminEmails: () => ["admin@bupulse.com"] }));

import { sendOfferEmail, sendOfferReminderEmail } from "@/lib/offers/emails";
import { runAsBackgroundJob } from "@/lib/platform/background-job";

const links = () => h.sent.flatMap((e) => [...`${e.html} ${e.text}`.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3001");
  vi.stubEnv("AUTH_EXTRA_ORIGINS", "https://test.bupulse.com");
  vi.stubEnv("PUBLIC_LINK_URL", "https://test.bupulse.com");
  h.sent = [];
  h.headers = null;
});

const offer = { company: "Kigali Salon", totalMinor: 29_000, currency: "RWF", interval: "MONTH", features: ["Website chat"], validUntil: new Date("2026-11-01T00:00:00Z"), note: null };

describe("links in emails", () => {
  it("an offer sent from the admin on the tunnel links to the tunnel", async () => {
    h.headers = new Headers({ host: "test.bupulse.com", "x-forwarded-proto": "https" });
    await sendOfferEmail({ email: "e.cyusa21+client@gmail.com", name: "Aline" }, offer);
    expect(links().filter((u) => u.includes("/dashboard/billing"))).not.toHaveLength(0);
    expect(links().some((u) => /localhost/.test(u))).toBe(false);
    expect(links().filter((u) => u.includes("/dashboard/billing")).every((u) => u.startsWith("https://test.bupulse.com/"))).toBe(true);
  });

  it("the day-3 reminder from the cron (called on localhost) links to the public address", async () => {
    h.headers = new Headers({ host: "localhost:3001" });
    await runAsBackgroundJob(() => sendOfferReminderEmail({ email: "e.cyusa21+client@gmail.com", name: null }, { day: 3, totalMinor: 29_000, currency: "RWF", interval: "MONTH", method: "momo" }));
    const billing = links().filter((u) => u.includes("/dashboard/billing"));
    expect(billing.length).toBeGreaterThan(0);
    expect(billing.every((u) => u.startsWith("https://test.bupulse.com/"))).toBe(true);
  });

  it("a forged Host never ends up in an email", async () => {
    h.headers = new Headers({ host: "evil.example", "x-forwarded-proto": "https" });
    await sendOfferEmail({ email: "e.cyusa21+client@gmail.com", name: null }, offer);
    expect(links().some((u) => u.includes("evil.example"))).toBe(false);
  });
});
