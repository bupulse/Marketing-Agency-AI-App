import { describe, expect, it } from "vitest";
import { cardUsdCents, currencyNote, formatMinor, localEquivalentMinor, REGION_SEEDS, regionKeyForCountryCode, regionKeyForCountryName } from "@/lib/region-format";
import { resolveDisplayRegionKey } from "@/lib/region";

// Regions as data: which region a country is in, how money is shown, and the card price of an RWF plan.

describe("region of a country", () => {
  it("Rwanda is RW, the EAC members are EAC, everything else (and nothing) is GLOBAL", () => {
    expect(regionKeyForCountryCode("RW")).toBe("RW");
    expect(regionKeyForCountryCode("rw")).toBe("RW");
    for (const c of ["KE", "UG", "TZ", "BI", "SS", "CD", "SO"]) expect(regionKeyForCountryCode(c)).toBe("EAC");
    expect(regionKeyForCountryCode("FR")).toBe("GLOBAL");
    expect(regionKeyForCountryCode("US")).toBe("GLOBAL");
    expect(regionKeyForCountryCode(null)).toBe("GLOBAL");
    expect(regionKeyForCountryCode("")).toBe("GLOBAL");
  });

  it("maps the sign-up country names", () => {
    expect(regionKeyForCountryName("Rwanda")).toBe("RW");
    expect(regionKeyForCountryName("Kenya")).toBe("EAC");
    expect(regionKeyForCountryName("Congo (Democratic Republic)")).toBe("EAC");
    expect(regionKeyForCountryName("Congo (Republic)")).toBe("GLOBAL");
    expect(regionKeyForCountryName("France")).toBe("GLOBAL");
    expect(regionKeyForCountryName(null)).toBe("GLOBAL");
  });

  it("ignores inactive regions and admin regions take their countries", () => {
    const regions = [...REGION_SEEDS.map((r) => (r.key === "EAC" ? { ...r, active: false } : r)), { key: "KE", name: "Kenya", currency: "KES", countries: ["KE"], paymentMethods: ["card" as const], active: true, sortOrder: 5 }];
    expect(regionKeyForCountryCode("KE", regions)).toBe("KE");
    expect(regionKeyForCountryCode("UG", regions)).toBe("GLOBAL");
  });
});

describe("display region", () => {
  it("takes ?region=, then the cookie, then the IP country, ignoring unknown keys", () => {
    expect(resolveDisplayRegionKey({ query: "EAC", cookie: "RW", country: "FR" }, REGION_SEEDS)).toBe("EAC");
    expect(resolveDisplayRegionKey({ query: "nope", cookie: "rw", country: "FR" }, REGION_SEEDS)).toBe("RW");
    expect(resolveDisplayRegionKey({ country: "KE" }, REGION_SEEDS)).toBe("EAC");
    expect(resolveDisplayRegionKey({ country: null }, REGION_SEEDS)).toBe("GLOBAL");
    expect(resolveDisplayRegionKey({ query: "EAC", country: "RW" }, REGION_SEEDS.map((r) => (r.key === "EAC" ? { ...r, active: false } : r)))).toBe("RW");
  });
});

describe("money", () => {
  it("formats RWF without decimals and USD as dollars", () => {
    expect(formatMinor(15000, "RWF")).toBe("15,000 RWF");
    expect(formatMinor(350000, "rwf")).toBe("350,000 RWF");
    expect(formatMinor(4900, "USD")).toBe("$49");
    expect(formatMinor(4950, "USD")).toBe("$49.50");
    expect(formatMinor(120000, "USD")).toBe("$1,200");
  });

  it("computes the card price: RWF / rate + margin, rounded up to whole dollars", () => {
    expect(cardUsdCents(15000, "RWF", 1450, 12)).toBe(1200); // 11.59 -> $12
    expect(cardUsdCents(150000, "RWF", 1450, 12)).toBe(11600); // 115.86 -> $116
    expect(cardUsdCents(35000, "RWF", 1450, 12)).toBe(2800); // 27.03 -> $28
    expect(cardUsdCents(350000, "RWF", 1450, 12)).toBe(27100);
    expect(cardUsdCents(14500, "RWF", 1450, 0)).toBe(1000); // exactly $10 stays $10
    expect(cardUsdCents(2500, "USD", 1450, 12)).toBe(2500); // USD is its own card price
    expect(() => cardUsdCents(100, "RWF", 0, 12)).toThrow();
    expect(localEquivalentMinor(1200, "RWF", 1450)).toBe(17400);
  });

  it("explains the currency and payment methods of a region", () => {
    expect(currencyNote("RWF", ["momo", "card"])).toMatch(/Rwandan francs.*Mobile Money or Card.*US dollars/);
    expect(currencyNote("USD", ["card"])).toMatch(/US dollars, paid by Card/);
  });
});
