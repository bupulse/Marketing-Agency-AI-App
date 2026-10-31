import { describe, expect, it } from "vitest";
import { alertFields, alertIntro, alertSubject, kigaliTime, sourceLabel, telegramText, type LeadAlert } from "@/lib/lead-alerts/format";

const quote = (over: Partial<LeadAlert> = {}): LeadAlert => ({
  kind: "quote",
  name: "Test Person",
  phone: "+250788123456",
  email: "test@example.com",
  company: "Sample Shop Ltd",
  note: "We sell shoes & bags <online>.",
  source: "instagram",
  page: "https://test.bupulse.com/quote?src=instagram",
  // 12:05 UTC is 14:05 in Kigali (UTC+2, no summer time).
  at: new Date("2026-10-31T12:05:00Z"),
  openUrl: "https://test.bupulse.com/admin/quotes",
  ...over,
});

describe("lead alert text", () => {
  it("names the company and who to call in the subject", () => {
    expect(alertSubject(quote())).toBe("New quote request: Sample Shop Ltd — call Test Person now");
    expect(alertSubject(quote({ kind: "support_chat", phone: null }))).toBe("New website chat: Sample Shop Ltd — reply to Test Person now");
    expect(alertSubject(quote({ company: null }))).toBe("New quote request: Test Person — call Test Person now");
  });

  it("says what happened", () => {
    expect(alertIntro(quote())).toContain("asked for a free quote");
    expect(alertIntro(quote({ kind: "support_chat" }))).toContain("started a chat");
  });

  it("gives the time in Kigali", () => {
    expect(kigaliTime(new Date("2026-10-31T12:05:00Z"))).toMatch(/31 Oct 2026, 14:05 \(Kigali time\)$/);
    expect(kigaliTime(new Date("2026-10-31T23:30:00Z"))).toMatch(/1 Nov 2026, 01:30/);
  });

  it("lists the details with tap-to-call and WhatsApp links, leaving out what is missing", () => {
    const fields = alertFields(quote());
    expect(fields.map((f) => f.label)).toEqual(["Name", "Phone", "WhatsApp", "Email", "Company", "Note", "Source", "Page", "Time"]);
    expect(fields.find((f) => f.label === "Phone")).toMatchObject({ value: "+250788123456", href: "tel:+250788123456" });
    expect(fields.find((f) => f.label === "WhatsApp")?.href).toBe("https://wa.me/250788123456");
    expect(fields.find((f) => f.label === "Source")?.value).toBe("Instagram");
    const bare = alertFields(quote({ phone: null, note: " ", source: null, page: null, company: null }));
    expect(bare.map((f) => f.label)).toEqual(["Name", "Email", "Time"]);
    expect(alertFields(quote({ kind: "support_chat" })).find((f) => f.label === "First message")).toBeTruthy();
  });

  it("labels source tags the way people say them", () => {
    expect(sourceLabel("quote_page")).toBe("Quote page");
    expect(sourceLabel("website")).toBe("Website");
    expect(sourceLabel(null)).toBeNull();
  });
});

describe("the Telegram message", () => {
  it("escapes what people typed and links WhatsApp and Admin", () => {
    const text = telegramText(quote());
    expect(text.split("\n")[0]).toBe("<b>New quote request: Sample Shop Ltd — call Test Person now</b>");
    expect(text).toContain("<b>Phone:</b> +250788123456");
    expect(text).toContain('<a href="https://wa.me/250788123456">Open a WhatsApp chat</a>');
    expect(text).toContain("We sell shoes &amp; bags &lt;online&gt;.");
    expect(text).not.toContain("<online>");
    expect(text).toContain('<a href="https://test.bupulse.com/admin/quotes">Open in Admin</a>');
    expect(text).toContain("14:05 (Kigali time)");
  });

  it("cuts a very long note well under Telegram's 4096 characters", () => {
    expect(telegramText(quote({ note: "x".repeat(5000) })).length).toBeLessThan(2500);
  });
});
