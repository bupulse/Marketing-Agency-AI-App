import { describe, expect, it } from "vitest";
import { alertFields, alertHeadline, alertIntro, alertSubject, kigaliTime, sourceLabel, telegramButtons, telegramText, type LeadAlert } from "@/lib/lead-alerts/format";

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
  it("starts with who and what they wrote, so the phone's pop-up says it before Telegram is opened", () => {
    const lines = telegramText(quote()).split("\n");
    expect(lines[0]).toBe("🔔 <b>Test Person from Sample Shop Ltd just requested a quote</b>");
    expect(lines[1]).toBe("“We sell shoes &amp; bags &lt;online&gt;.”");
  });

  it("escapes what people typed and lists the details, the links being buttons", () => {
    const text = telegramText(quote());
    expect(text).toContain("<b>Phone:</b> +250788123456");
    expect(text).not.toContain("<online>");
    expect(text).not.toContain("<b>Note:</b>");
    expect(text).not.toContain("wa.me");
    expect(text).toContain("14:05 (Kigali time)");
  });

  it("names the person as they typed it, without a company when there is none, and says a chat is a chat", () => {
    expect(alertHeadline(quote({ company: null }))).toBe("Test Person just requested a quote");
    expect(alertHeadline(quote({ kind: "support_chat" }))).toBe("Test Person from Sample Shop Ltd started a chat on the website");
  });

  it("cuts a very long note well under Telegram's 4096 characters", () => {
    expect(telegramText(quote({ note: "x".repeat(5000) })).length).toBeLessThan(2500);
  });
});

describe("the Telegram buttons", () => {
  it("calls through the site's /call page, then WhatsApp, then Admin", () => {
    expect(telegramButtons(quote(), "https://test.bupulse.com/")).toEqual([
      [{ text: "📞 Call Test", url: "https://test.bupulse.com/call/250788123456" }],
      [{ text: "💬 WhatsApp", url: "https://wa.me/250788123456" }],
      [{ text: "Open in Admin", url: "https://test.bupulse.com/admin/quotes" }],
    ]);
  });

  it("has no Call or WhatsApp button without a phone number", () => {
    expect(telegramButtons(quote({ phone: null }), "https://test.bupulse.com").flat().map((b) => b.text)).toEqual(["Open in Admin"]);
  });
});

describe("contact form and waiting chat alerts", () => {
  it("names the form the message came from", () => {
    const contact = quote({ kind: "contact", source: "done_for_you", note: "Please run our pages." });
    expect(alertSubject(contact)).toBe("New done for you request: Sample Shop Ltd — call Test Person now");
    expect(alertSubject(quote({ kind: "contact", source: "contact" }))).toMatch(/^New contact request:/);
    expect(alertIntro(contact)).toContain("Done for you form");
    expect(alertHeadline(contact)).toBe("Test Person from Sample Shop Ltd sent the Done for you form");
    expect(alertFields(contact).find((f) => f.label === "Message")?.value).toBe("Please run our pages.");
    expect(telegramText(contact).split("\n")[1]).toBe("“Please run our pages.”");
  });

  it("a ticket outside team hours says the team is away", () => {
    const waiting = quote({ kind: "support_waiting", chat: { number: 12, reason: "outside team hours", away: true }, openUrl: "https://test.bupulse.com/support/?c=c1" });
    expect(alertHeadline(waiting)).toBe("Test Person from Sample Shop Ltd left a message for the team (chat #12, outside hours)");
    expect(alertIntro(waiting)).toContain("outside team hours");
    expect(telegramButtons(waiting, "https://test.bupulse.com").flat().map((b) => b.text)).toContain("Open the chat");
  });
});
