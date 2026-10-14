import { describe, expect, it } from "vitest";
import {
  contactDisplay,
  contactHref,
  normaliseContact,
  normaliseSocial,
  normaliseWebsite,
  parseLegacyContact,
  quickActions,
  summarizeContacts,
  type Contact,
} from "@/lib/business-info/contacts";

describe("normaliseContact", () => {
  it("stores phone numbers as E.164 for the chosen country", () => {
    for (const typed of ["0791954277", "+250 791 954 277", "791954277"]) {
      expect(normaliseContact("whatsapp", typed, "RW", "Rwanda")).toEqual({ ok: true, value: "+250791954277" });
    }
    const wrong = normaliseContact("phone", "12345", "RW", "Rwanda");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain("Rwandan");
    // A Kenyan number on a Rwandan contact is a typo.
    expect(normaliseContact("phone", "+254712345678", "RW", "Rwanda").ok).toBe(false);
    expect(normaliseContact("phone", "+254712345678", "KE", "Kenya")).toEqual({ ok: true, value: "+254712345678" });
  });
  it("accepts a number pasted after the +250 the field fills in (the step 4 bug)", () => {
    for (const shown of ["+250 250788123456", "+250 +250 788 123 456", "+250 0788 123 456", "+250 250-788-123-456"]) {
      expect(normaliseContact("whatsapp", shown, "RW", "Rwanda")).toEqual({ ok: true, value: "+250788123456" });
    }
  });
  it("validates emails and websites", () => {
    expect(normaliseContact("email", " Hello@Shop.RW ", null)).toEqual({ ok: true, value: "hello@shop.rw" });
    expect(normaliseContact("email", "not-an-email", null).ok).toBe(false);
    expect(normaliseContact("website", "shop.rw", null)).toEqual({ ok: true, value: "https://shop.rw" });
    expect(normaliseContact("website", "http://www.shop.rw/menu#top", null)).toEqual({ ok: true, value: "http://www.shop.rw/menu" });
    expect(normaliseContact("website", "javascript:alert(1)", null).ok).toBe(false);
    expect(normaliseContact("website", "https://user:pw@shop.rw", null).ok).toBe(false);
    expect(normaliseContact("website", "not a site", null).ok).toBe(false);
  });
  it("accepts a social handle or a link and keeps the handle", () => {
    for (const typed of ["@Shop.Kigali", "shop.kigali", "instagram.com/shop.kigali/", "https://www.instagram.com/shop.kigali?igsh=abc"]) {
      expect(normaliseSocial("instagram", typed)).toBe("shop.kigali");
    }
    expect(normaliseSocial("tiktok", "https://www.tiktok.com/@glow.studio")).toBe("glow.studio");
    expect(normaliseSocial("facebook", "https://m.facebook.com/GlowStudioRW/")).toBe("GlowStudioRW");
    expect(normaliseSocial("facebook", "https://www.facebook.com/profile.php?id=1000123")).toBe("profile.php?id=1000123");
    expect(normaliseSocial("facebook", "profile.php?id=1000123")).toBe("profile.php?id=1000123");
    // A link to another site is not this network's profile.
    expect(normaliseSocial("instagram", "https://evil.example/shop")).toBeNull();
    expect(normaliseSocial("instagram", "has spaces")).toBeNull();
    // A stray "%" must be a field error, not a crash (decodeURIComponent throws on it).
    expect(normaliseSocial("instagram", "100%")).toBeNull();
    expect(normaliseSocial("facebook", "https://facebook.com/%E0%A4%A")).toBeNull();
    expect(normaliseContact("tiktok", "@shop%", null).ok).toBe(false);
  });
  it("normalises websites idempotently", () => {
    const once = normaliseWebsite("Shop.rw/Menu");
    expect(once).toBe("https://shop.rw/Menu");
    expect(normaliseWebsite(once!)).toBe(once);
  });
});

describe("links and display", () => {
  const wa: Contact = { type: "whatsapp", value: "+250791954277" };
  it("builds wa.me, tel: and profile links", () => {
    expect(contactHref(wa)).toBe("https://wa.me/250791954277");
    expect(contactHref({ type: "phone", value: "+250791954277" })).toBe("tel:+250791954277");
    expect(contactHref({ type: "instagram", value: "shop" })).toBe("https://www.instagram.com/shop");
    expect(contactHref({ type: "tiktok", value: "shop" })).toBe("https://www.tiktok.com/@shop");
    expect(contactDisplay(wa)).toBe("+250 791 954 277");
    expect(contactDisplay({ type: "instagram", value: "shop" })).toBe("@shop");
  });
  it("picks the widget buttons from the main contact first", () => {
    const contacts: Contact[] = [
      { type: "phone", value: "+250788000001" },
      { type: "whatsapp_call", value: "+250788000002", primary: true },
      { type: "whatsapp", value: "+250788000003" },
    ];
    expect(quickActions(contacts)).toEqual({ whatsapp: "https://wa.me/250788000002", call: "tel:+250788000002" });
    expect(quickActions([{ type: "whatsapp", value: "+250788000003" }, { type: "email", value: "a@b.co", primary: true }])).toEqual({ whatsapp: "https://wa.me/250788000003", call: undefined });
    expect(quickActions([])).toEqual({ whatsapp: undefined, call: undefined });
  });
  it("summarises contacts for the AI", () => {
    expect(summarizeContacts([{ type: "whatsapp_call", value: "+250791954277", primary: true }, { type: "instagram", value: "shop" }])).toBe(
      "WhatsApp and phone calls +250 791 954 277 (main contact); Instagram @shop (https://www.instagram.com/shop)",
    );
  });
});

describe("parseLegacyContact", () => {
  it("finds numbers and emails in old free text", () => {
    expect(parseLegacyContact("Call me maybe 12", "RW").contacts).toEqual([]); // too short to be a number
    const r = parseLegacyContact("Call or WhatsApp 0791 954 277", "RW");
    expect(r).toEqual({ contacts: [{ type: "whatsapp_call", value: "+250791954277", primary: true }], rest: "" });
    const both = parseLegacyContact("WhatsApp 0791954277 or hello@glow.rw", "RW");
    expect(both.contacts.map((c) => c.type)).toEqual(["whatsapp", "email"]);
  });
  it("keeps the text as a note when something meaningful is left or nothing was found", () => {
    expect(parseLegacyContact("Call 0791954277 and ask for Grace", "RW").rest).toBe("Call 0791954277 and ask for Grace");
    expect(parseLegacyContact("Visit our shop", "RW")).toEqual({ contacts: [], rest: "Visit our shop" });
  });
});
