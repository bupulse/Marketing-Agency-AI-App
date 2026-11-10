import { describe, expect, it } from "vitest";
import { displaySite, siteLine, withSiteLine } from "@/lib/publishing/site-line";

describe("the company's website on every post (owner's decision, 10 November 2026)", () => {
  it("writes the website the way people type it", () => {
    expect(displaySite("https://www.bupulse.com/")).toBe("bupulse.com");
    expect(displaySite("bupulse.com/shop")).toBe("bupulse.com/shop");
    expect(displaySite("")).toBeNull();
    expect(displaySite(null)).toBeNull();
    expect(displaySite("not a site")).toBeNull();
  });

  it("puts the address on LinkedIn and the other apps, and Link in bio on Instagram, Facebook and TikTok", () => {
    expect(siteLine("linkedin", "https://bupulse.com", "English")).toBe("https://bupulse.com");
    expect(siteLine("twitter", "bupulse.com", "English")).toBe("https://bupulse.com");
    expect(siteLine("youtube", "bupulse.com", "English")).toBe("https://bupulse.com");
    expect(siteLine("instagram", "bupulse.com", "English")).toBe("🔗 Link in bio");
    expect(siteLine("facebook", "bupulse.com", "Kinyarwanda")).toBe("🔗 Link iri muri bio");
    expect(siteLine("tiktok", "bupulse.com", "French")).toBe("🔗 Lien dans la bio");
    expect(siteLine("instagram", "bupulse.com", "Japanese")).toBe("🔗 Link in bio");
  });

  it("adds the line at the end of the caption", () => {
    expect(withSiteLine("New offer this week.", "linkedin", "bupulse.com", "English")).toBe("New offer this week.\n\nhttps://bupulse.com");
    expect(withSiteLine("Offer!  ", "instagram", "bupulse.com", "Kinyarwanda")).toBe("Offer!\n\n🔗 Link iri muri bio");
  });

  it("leaves the caption alone without a website, or when the address or the bio is already in it", () => {
    expect(withSiteLine("Hello", "linkedin", null, "English")).toBe("Hello");
    expect(withSiteLine("Visit www.BuPulse.com today", "linkedin", "https://bupulse.com", "English")).toBe("Visit www.BuPulse.com today");
    expect(withSiteLine("See bupulse.com", "instagram", "bupulse.com", "English")).toBe("See bupulse.com");
    expect(withSiteLine("Order now, link in our bio!", "instagram", "bupulse.com", "English")).toBe("Order now, link in our bio!");
    expect(withSiteLine("Gura ubu! Link iri muri bio", "facebook", "bupulse.com", "Kinyarwanda")).toBe("Gura ubu! Link iri muri bio");
  });

  it("never pushes a post past the app's limit, hashtags counted", () => {
    const text = "x".repeat(140);
    expect(withSiteLine(text, "tiktok", "bupulse.com", "English", { maxLength: 150 })).toBe(text);
    expect(withSiteLine("short", "tiktok", "bupulse.com", "English", { maxLength: 150, reserved: 140 })).toBe("short");
    expect(withSiteLine("short", "tiktok", "bupulse.com", "English", { maxLength: 150, reserved: 20 })).toBe("short\n\n🔗 Link in bio");
  });
});
