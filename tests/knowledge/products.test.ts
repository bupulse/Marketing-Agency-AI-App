import { describe, expect, it } from "vitest";
import { fieldErrorMap, formatPrice, legacyPriceModel, parsePriceText, priceLine, productFormValues, productInputSchema, productReadiness, readDetails, toMinor, type ProductInput } from "@/lib/knowledge/products";

const base = { name: "Sisal basket", summary: "Hand-woven in Huye.", priceModel: "FIXED", price: "15,000", currency: "RWF", usps: ["Made by a cooperative"] } as const;
const parse = (input: Record<string, unknown>) => productInputSchema.safeParse(input as ProductInput);
const errors = (input: Record<string, unknown>) => {
  const r = parse(input);
  return r.success ? {} : fieldErrorMap(r.error);
};

describe("product validation", () => {
  it("requires the kind, name, short description, price model and at least one selling point", () => {
    expect(errors({})).toMatchObject({ kind: expect.any(String) });
    const e = errors({ kind: "PHYSICAL", name: " ", summary: "", priceModel: "", usps: [], currency: "RWF" });
    expect(Object.keys(e)).toEqual(expect.arrayContaining(["name", "summary", "priceModel", "usps"]));
  });

  it("needs a readable price unless it is on request, in the currency's own units", () => {
    expect(errors({ kind: "PHYSICAL", ...base, price: "" })).toMatchObject({ price: "Enter the price, or choose On request." });
    expect(errors({ kind: "PHYSICAL", ...base, price: "cheap" })).toMatchObject({ price: "Enter a number, e.g. 15000." });
    expect(errors({ kind: "PHYSICAL", ...base, price: "15000.5" })).toMatchObject({ price: expect.any(String) }); // francs have no decimals
    expect(errors({ kind: "PHYSICAL", ...base, price: "99999999999" })).toMatchObject({ price: "That price is too large." });
    expect(parse({ kind: "PHYSICAL", ...base, priceModel: "ON_REQUEST", price: "" }).data).toMatchObject({ priceAmount: null });
    expect(parse({ kind: "DIGITAL", ...base, price: "49.99", currency: "usd" }).data).toMatchObject({ priceAmount: 4999, currency: "USD" });
    expect(parse({ kind: "PHYSICAL", ...base }).data).toMatchObject({ priceAmount: 15000 });
  });

  it("shows every problem at once, the price too, while other fields are wrong", () => {
    expect(Object.keys(errors({ kind: "SERVICE", ...base, name: "", price: "" }))).toEqual(expect.arrayContaining(["name", "price"]));
  });

  it("keeps only the chosen kind's details and checks them", () => {
    const physical = parse({ kind: "PHYSICAL", ...base, details: { variants: ["Large", "large", " Small "], condition: "used", delivery: "Moto in Kigali", warranty: "", trial: true } }).data!;
    expect(physical.details).toEqual({ variants: ["Large", "Small"], condition: "used", delivery: "Moto in Kigali", warranty: null });
    const digital = parse({ kind: "DIGITAL", ...base, details: { access: ["download", "download", "email"], trial: true, variants: ["x"] } }).data!;
    expect(digital.details).toEqual({ access: ["download", "email"], platform: null, licence: null, trial: true });
    const service = parse({ kind: "SERVICE", ...base, details: { duration: "1 hour", places: ["online"], bookingNeeded: true } }).data!;
    expect(service.details).toEqual({ duration: "1 hour", places: ["online"], bookingNeeded: true });
    expect(errors({ kind: "PHYSICAL", ...base, details: { condition: "broken" } })).toHaveProperty(["details.condition"]);
    expect(errors({ kind: "DIGITAL", ...base, details: { access: ["telepathy"] } })).toHaveProperty(["details.access"]);
    expect(errors({ kind: "SERVICE", ...base, details: { places: ["moon"] } })).toHaveProperty(["details.places"]);
    expect(errors({ kind: "PHYSICAL", ...base, details: { warranty: "x".repeat(201) } })).toHaveProperty(["details.warranty"]);
  });

  it("cleans lists: trimmed, no blanks or duplicates, and capped", () => {
    expect(parse({ kind: "PHYSICAL", ...base, usps: [" Local ", "local", ""], features: ["a", "A", " b "] }).data).toMatchObject({ usps: ["Local"], features: ["a", "b"] });
    expect(errors({ kind: "PHYSICAL", ...base, usps: Array.from({ length: 11 }, (_, i) => `p${i}`) })).toHaveProperty("usps");
    expect(errors({ kind: "PHYSICAL", ...base, features: ["x".repeat(161)] })).toHaveProperty("features");
  });

  it("reads stored details leniently", () => {
    expect(readDetails("PHYSICAL", null)).toEqual({ variants: [], condition: null, delivery: null, warranty: null });
    expect(readDetails("SERVICE", { duration: 5 })).toEqual({ duration: null, places: [], bookingNeeded: false });
  });
});

describe("prices", () => {
  it("formats every model", () => {
    const p = { priceAmount: 15000, currency: "RWF", priceNote: null };
    expect(formatPrice({ ...p, priceModel: "FIXED" })).toBe("15,000 RWF");
    expect(formatPrice({ ...p, priceModel: "FROM" })).toBe("From 15,000 RWF");
    expect(formatPrice({ ...p, priceModel: "PER_MONTH" })).toBe("15,000 RWF a month");
    expect(formatPrice({ priceAmount: 4999, currency: "USD", priceModel: "PER_YEAR" })).toBe("$49.99 a year");
    expect(formatPrice({ priceAmount: null, currency: "RWF", priceModel: "ON_REQUEST" })).toBe("Price on request");
    expect(formatPrice({ priceAmount: null, currency: "RWF", priceModel: "FROM", priceNote: "From $49" })).toBe("From $49");
    expect(priceLine({ ...p, priceModel: "PER_UNIT", priceNote: "per kilo" })).toBe("15,000 RWF per unit · per kilo");
    // A note that only repeats the amount (a store's price text) is not shown twice.
    expect(priceLine({ priceAmount: 1900, currency: "USD", priceModel: "FIXED", priceNote: "$19.00" })).toBe("$19");
  });

  it("reads typed and free-text prices", () => {
    expect(toMinor("15 000", "RWF")).toBe(15000);
    expect(toMinor("49.9", "USD")).toBe(4990);
    expect(toMinor("1.234", "USD")).toBeNull();
    expect(parsePriceText("From $49", "RWF")).toEqual({ priceModel: "FROM", price: "49", currency: "USD" });
    expect(parsePriceText("20,000 Frw per month", "USD")).toEqual({ priceModel: "PER_MONTH", price: "20000", currency: "RWF" });
    expect(parsePriceText("Free entry", "RWF")).toBeNull();
    expect(parsePriceText("2 for 5,000", "RWF")).toBeNull(); // two numbers: the owner confirms it
    expect(legacyPriceModel("$485,000")).toBe("FIXED");
    expect(legacyPriceModel("10% off")).toBe("FIXED");
    expect(legacyPriceModel("$900 / month")).toBe("PER_MONTH");
    expect(legacyPriceModel("Annual plan 120,000")).toBe("PER_YEAR");
    expect(legacyPriceModel(null)).toBe("ON_REQUEST");
  });

  it("prefills the form from a migrated free-text price", () => {
    const stored = { kind: "PHYSICAL" as const, name: "Loaf", category: null, summary: "Bread", description: null, priceModel: "FROM" as const, priceAmount: null, currency: "RWF", priceNote: "From 3,500 RWF", usps: [], features: [], targetCustomer: null, status: "ACTIVE" as const, details: null };
    expect(productFormValues(stored, "RWF")).toMatchObject({ priceModel: "FROM", price: "3500", currency: "RWF", priceNote: "" });
    expect(productFormValues({ ...stored, priceNote: "Ask us" }, "RWF")).toMatchObject({ price: "", priceNote: "Ask us" });
    expect(productFormValues(null, "RWF")).toMatchObject({ kind: "PHYSICAL", currency: "RWF", usps: [] });
  });

  it("says what a product still needs", () => {
    expect(productReadiness({ summary: "x", usps: [], priceModel: "FIXED", priceAmount: null, photoCount: 0 }).missing).toEqual(["a reason to choose it", "a price", "a photo"]);
    expect(productReadiness({ summary: "x", usps: ["y"], priceModel: "ON_REQUEST", priceAmount: null, photoCount: 1 }).ready).toBe(true);
  });
});
