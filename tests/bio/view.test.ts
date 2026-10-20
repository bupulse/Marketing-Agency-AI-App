import { describe, expect, it } from "vitest";
import { renderBioPage } from "@/lib/bio/page";
import { RESERVED_SLUGS, slugProblem, slugify, suggestSlug } from "@/lib/bio/slug";
import { bioSource } from "@/lib/bio/source";
import { buildBioView, defaultMessage, platformOf, validateBioSettings, whatsAppHref, type BioSettings, type BioSource } from "@/lib/bio/view";
import type { StoredKnowledge } from "@/lib/brand/schemas";

const SETTINGS: BioSettings = {
  enabled: true,
  slug: "test-shop",
  tagline: "",
  whatsapp: "+250700000001",
  message: "",
  phone: "+250700000002",
  location: "KN 4 Ave, Kigali, Rwanda",
  landmark: "Opposite the TEST bus park",
  showHours: true,
  links: ["instagram"],
  productIds: ["p2", "p1"],
};

const KNOWLEDGE: StoredKnowledge = {
  hours: undefined,
  area: undefined,
  contact: undefined,
  faqs: [],
  openingHours: [{ days: ["mon", "tue", "wed", "thu", "fri"], open: "08:00", close: "18:00" }],
  locations: [{ kind: "head", address: "KN 4 Ave, Kigali, Rwanda" }],
  contacts: [
    { type: "whatsapp", value: "+250700000001", primary: true },
    { type: "phone", value: "+250700000002" },
    { type: "email", value: "test@example.com" },
    { type: "instagram", value: "test.shop" },
    { type: "tiktok", value: "test.shop" },
  ],
};

function source(over: Partial<Parameters<typeof bioSource>[0]> = {}): BioSource {
  return bioSource({
    name: "TEST Shop",
    tagline: null,
    description: "Shoes and bags",
    accent: "#2F6BFF",
    knowledge: KNOWLEDGE,
    timezone: "Africa/Kigali",
    logoUrl: null,
    products: [
      { id: "p1", name: "Leather bag", summary: "Hand made", priceModel: "FIXED", priceAmount: 25000, currency: "RWF", priceNote: null, photoUrl: "/b/test-shop/photo/a.jpg" },
      { id: "p2", name: "Sandals", summary: "", priceModel: "FROM", priceAmount: 8000, currency: "RWF", priceNote: null, photoUrl: null },
    ],
    // A Monday at 10:00 in Kigali (08:00 UTC).
    now: new Date("2026-10-19T08:00:00Z"),
    ...over,
  });
}

describe("page addresses", () => {
  it("makes a clean address from a business name", () => {
    expect(slugify("Kigali Shoes & Bags Ltd.")).toBe("kigali-shoes-bags-ltd");
    expect(slugify("Café Één")).toBe("cafe-een");
    expect(suggestSlug("A")).toBe("a-rw");
    expect(suggestSlug("BuPulse")).toBe("my-shop");
  });

  it("refuses short, odd, reserved and BuPulse-looking addresses", () => {
    expect(slugProblem("ab")).toMatch(/3 to 30/);
    expect(slugProblem("Shop")).toMatch(/small letters/);
    expect(slugProblem("-shop")).toMatch(/small letters/);
    expect(slugProblem("my--shop")).toMatch(/one dash/);
    expect(slugProblem("admin")).toMatch(/kept for BuPulse/);
    expect(slugProblem("bupulse-rwanda")).toMatch(/kept for BuPulse/);
    expect(slugProblem("kigali-shoes")).toBeNull();
    for (const slug of RESERVED_SLUGS) expect(slugProblem(slug), slug).not.toBeNull();
  });

  it("validates the settings form and keeps the address lower case", () => {
    const ok = validateBioSettings({ ...SETTINGS, slug: "Kigali-Shoes", productIds: ["p1", "p1"] });
    expect(ok).toMatchObject({ ok: true, data: { slug: "kigali-shoes", productIds: ["p1"] } });
    expect(validateBioSettings({ ...SETTINGS, slug: "admin" })).toMatchObject({ ok: false, errors: { slug: expect.stringMatching(/kept/) } });
    expect(validateBioSettings({ ...SETTINGS, tagline: "x".repeat(121) })).toMatchObject({ ok: false, errors: { tagline: expect.any(String) } });
    expect(validateBioSettings({ ...SETTINGS, productIds: Array.from({ length: 13 }, (_, i) => `p${i}`) })).toMatchObject({ ok: false, errors: { productIds: expect.any(String) } });
    expect(validateBioSettings({ ...SETTINGS, links: ["email"] }).ok).toBe(false);
  });
});

describe("what the page shows", () => {
  it("builds the buttons, place, hours and products from the company's data, in the owner's order", () => {
    const view = buildBioView(source(), SETTINGS, { platform: "Instagram" });
    expect(view.tagline).toBe("Shoes and bags");
    expect(view.whatsapp?.href).toBe(whatsAppHref("+250700000001", "Hello, I saw your page on Instagram."));
    expect(view.whatsapp?.href).toContain("https://wa.me/250700000001?text=Hello%2C%20I%20saw%20your%20page%20on%20Instagram.");
    expect(view.call).toEqual({ href: "tel:+250700000002", display: expect.stringContaining("700") });
    expect(view.place).toMatchObject({ text: "KN 4 Ave, Kigali", landmark: "Opposite the TEST bus park" });
    expect(view.place?.mapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\//);
    expect(view.hours).toMatchObject({ open: true, status: "We're open now until 18:00." });
    expect(view.hours?.lines).toEqual(["Mon–Fri 08:00–18:00", "Sat, Sun closed"]);
    expect(view.items.map((i) => [i.name, i.price])).toEqual([["Sandals", "From 8,000 RWF"], ["Leather bag", "25,000 RWF"]]);
    expect(decodeURIComponent(view.items[1].askHref!)).toContain("I would like to ask about: Leather bag.");
    expect(view.links).toEqual([{ type: "instagram", label: "Instagram", href: "https://www.instagram.com/test.shop", display: "@test.shop" }]);
  });

  it("shows only what the owner picked, and nothing the company no longer has", () => {
    const none = buildBioView(source(), { ...SETTINGS, whatsapp: null, phone: null, location: null, showHours: false, links: [], productIds: [] });
    expect(none).toMatchObject({ whatsapp: null, call: null, place: null, hours: null, links: [], items: [] });
    // A number, place or product removed from the Knowledge base disappears from the page.
    const gone = buildBioView(source({ knowledge: { ...KNOWLEDGE, contacts: [], locations: [] }, products: [] }), SETTINGS);
    expect(gone).toMatchObject({ whatsapp: null, call: null, place: null, items: [] });
    // The email is never offered as a link.
    expect(source().links.map((l) => l.type)).toEqual(["instagram", "tiktok"]);
  });

  it("greets in the app the visitor came from, unless the owner wrote the message", () => {
    expect(platformOf("Mozilla/5.0 (iPhone) Instagram 300.0")).toBe("Instagram");
    expect(platformOf("Mozilla/5.0 (Linux; Android) trill_2023 BytedanceWebview")).toBe("TikTok");
    expect(platformOf("Mozilla/5.0 Chrome/120")).toBeNull();
    expect(defaultMessage(null)).toBe("Hello, I saw your page.");
    const own = buildBioView(source(), { ...SETTINGS, message: "Muraho!" }, { platform: "TikTok" });
    expect(own.whatsapp?.href).toContain("text=Muraho!");
  });

  it("has no live status when the time zone was never set", () => {
    expect(buildBioView(source({ timezone: "UTC" }), SETTINGS).hours).toMatchObject({ status: null, open: null });
  });
});

describe("the page HTML", () => {
  const view = buildBioView(source({ name: `TEST <script>alert("x")</script>` }), SETTINGS);

  it("escapes the owner's text and links, and only the live page loads the counter", () => {
    const live = renderBioPage({ view, mode: "live", nonce: "abc", pageUrl: "https://bupulse.com/b/test-shop", ogImage: "https://bupulse.com/b/test-shop/photo/x.jpg", siteUrl: "https://bupulse.com" });
    expect(live).not.toContain("<script>alert");
    expect(live).toContain("TEST &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(live).toContain('<script src="/bio.js" defer></script>');
    expect(live).toContain('<style nonce="abc">');
    expect(live).toContain('<meta property="og:image" content="https://bupulse.com/b/test-shop/photo/x.jpg">');
    expect(live).toContain('<link rel="canonical" href="https://bupulse.com/b/test-shop">');
    expect(live).toContain('data-t="wa"');
    expect(live).toContain('data-t="call"');
    // The first row of photos loads at once; only later ones wait for the scroll.
    expect(live).not.toContain('loading="lazy"');
    const preview = renderBioPage({ view, mode: "preview", siteUrl: "https://bupulse.com" });
    expect(preview).not.toContain("bio.js");
    expect(preview).toContain('<base target="_blank">');
  });
});
