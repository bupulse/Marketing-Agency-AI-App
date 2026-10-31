import { describe, expect, it } from "vitest";
import { normaliseQuotePhone, telHref, whatsappHref } from "@/lib/quote/phone";
import { cleanPagePath, cleanQuoteSource, POPUP_SOURCE, QUOTE_PAGE_SOURCE, quoteSchema } from "@/lib/quote/schema";

describe("quote phone numbers", () => {
  it("reads the Rwandan ways of writing a number as +250", () => {
    for (const typed of ["0788 123 456", "0788123456", "788123456", "+250 788 123 456", "+250788123456", "250788123456", "00250 788 123 456", "(078) 812-3456", "+250 0788 123 456"]) {
      expect(normaliseQuotePhone(typed), typed).toBe("+250788123456");
    }
  });

  it("keeps another country's number when it is written with its code", () => {
    expect(normaliseQuotePhone("+254 712 345 678")).toBe("+254712345678");
    expect(normaliseQuotePhone("0044 7911 123456")).toBe("+447911123456");
  });

  it("refuses what is not a phone number", () => {
    for (const typed of ["", "   ", "hello", "0788", "12345678901234567890", "0712 345 678", "+250 788 12", "0788-123-456 ext 2"]) {
      expect(normaliseQuotePhone(typed), typed).toBeNull();
    }
  });

  it("makes tap-to-call and WhatsApp links", () => {
    expect(telHref("+250788123456")).toBe("tel:+250788123456");
    expect(whatsappHref("+250788123456")).toBe("https://wa.me/250788123456");
  });
});

describe("quote source and page", () => {
  it("turns a link's ?src= into a short tag", () => {
    expect(cleanQuoteSource("Instagram")).toBe("instagram");
    expect(cleanQuoteSource("ig")).toBe("instagram");
    expect(cleanQuoteSource("FB")).toBe("facebook");
    expect(cleanQuoteSource("wa")).toBe("whatsapp");
    expect(cleanQuoteSource("tiktok")).toBe("tiktok");
    expect(cleanQuoteSource("flyer_kigali-2026")).toBe("flyer_kigali-2026");
  });

  it("falls back for nothing or nonsense", () => {
    expect(cleanQuoteSource(null)).toBe(POPUP_SOURCE);
    expect(cleanQuoteSource("")).toBe(POPUP_SOURCE);
    expect(cleanQuoteSource("<script>")).toBe(POPUP_SOURCE);
    expect(cleanQuoteSource("x".repeat(41))).toBe(POPUP_SOURCE);
    expect(cleanQuoteSource(undefined, QUOTE_PAGE_SOURCE)).toBe(QUOTE_PAGE_SOURCE);
  });

  it("keeps only a path of this site for the page", () => {
    expect(cleanPagePath("/pricing?src=instagram")).toBe("/pricing?src=instagram");
    expect(cleanPagePath("https://test.bupulse.com/about")).toBe("/about");
    expect(cleanPagePath("javascript:alert(1)")).toBeNull();
    expect(cleanPagePath("pricing")).toBeNull();
    expect(cleanPagePath("")).toBeNull();
    expect(cleanPagePath(`/${"a".repeat(600)}`)?.length).toBe(500);
  });
});

describe("quote form rules", () => {
  const good = { name: " Test Person ", phone: "0788 123 456", email: " Test@Example.com ", businessName: "Sample Shop Ltd", note: "", source: "ig", pageUrl: "/pricing" };

  it("accepts a complete request and cleans it", () => {
    const r = quoteSchema.safeParse(good);
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ name: "Test Person", phone: "+250788123456", email: "test@example.com", businessName: "Sample Shop Ltd", note: undefined, source: "instagram", pageUrl: "/pricing" });
  });

  it("keeps the optional note", () => {
    expect(quoteSchema.parse({ ...good, note: " We sell shoes. " }).note).toBe("We sell shoes.");
  });

  it("needs a name, a phone, an email and a company", () => {
    const r = quoteSchema.safeParse({ name: "", phone: "", email: "", businessName: "" });
    expect(r.success).toBe(false);
    const fields = new Set(r.error!.issues.map((i) => String(i.path[0])));
    expect([...fields].sort()).toEqual(["businessName", "email", "name", "phone"]);
  });

  it("explains a phone number it cannot read", () => {
    const r = quoteSchema.safeParse({ ...good, phone: "12345" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ["phone"], message: expect.stringContaining("0788 123 456") });
  });

  it("refuses a malformed email and an overlong note", () => {
    expect(quoteSchema.safeParse({ ...good, email: "not-an-email" }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...good, note: "x".repeat(2001) }).success).toBe(false);
  });
});
