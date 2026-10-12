import { describe, expect, it } from "vitest";
import { EssentialsBanner } from "@/components/business-info/essentials-banner";
import { initialValues } from "@/components/brand-profile/initial";
import { emptyLocation, knowledgeInput, validateStep, type BrandValues } from "@/components/brand-profile/steps";
import { ESSENTIALS_ERRORS, readKnowledge, validateKnowledge } from "@/lib/brand/schemas";
import { hasEssentials, missingEssentials } from "@/lib/business-info/facts";

const strict = { requireEssentials: true, country: "Rwanda" };
const head = { ...emptyLocation("head"), address: "KN 4 Avenue, Kigali" };
const phone = { type: "whatsapp" as const, value: "0791954277", country: "Rwanda", primary: true };
const weekdays = { days: ["mon" as const, "tue" as const], open: "08:00", close: "18:00" };
const full = { faqs: [], openingHours: [weekdays], locations: [head], contacts: [phone] };

describe("required: hours, head office, phone", () => {
  it("passes with all three", () => {
    expect(validateKnowledge(full, strict).ok).toBe(true);
  });
  it("names each missing one under its own field", () => {
    const r = validateKnowledge({ faqs: [] }, strict);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ "openingHours.form": ESSENTIALS_ERRORS.hours, "locations.0.address": ESSENTIALS_ERRORS.location, "contacts.form": ESSENTIALS_ERRORS.phone });
  });
  it("hours: one schedule with a day, or open 24 hours", () => {
    const none = validateKnowledge({ ...full, openingHours: [] }, strict);
    expect(!none.ok && none.errors["openingHours.form"]).toBe(ESSENTIALS_ERRORS.hours);
    const noDay = validateKnowledge({ ...full, openingHours: [{ ...weekdays, days: [] }] }, strict);
    expect(!noDay.ok && noDay.errors["openingHours.0.days"]).toBeTruthy();
    const allDay = validateKnowledge({ ...full, openingHours: [{ days: ["sun"], open: "00:00", close: "23:59", allDay: true }] }, strict);
    expect(allDay.ok).toBe(true);
  });
  it("head office: searched or entered by hand; branches don't count", () => {
    const branchOnly = validateKnowledge({ ...full, locations: [emptyLocation("head"), { ...emptyLocation("branch"), address: "Musanze" }] }, strict);
    expect(!branchOnly.ok && branchOnly.errors["locations.0.address"]).toBeTruthy();
    const manual = validateKnowledge({ ...full, locations: [{ ...emptyLocation("head"), manual: true, area: "Kiyovu", city: "Kigali" }] }, strict);
    expect(manual.ok).toBe(true);
    const manualEmpty = validateKnowledge({ ...full, locations: [{ ...emptyLocation("head"), manual: true }] }, strict);
    expect(!manualEmpty.ok && manualEmpty.errors["locations.0.street"]).toBe(ESSENTIALS_ERRORS.location);
  });
  it("phone: WhatsApp, phone call or both; email and socials alone are not enough", () => {
    for (const type of ["whatsapp", "phone", "whatsapp_call"] as const) expect(validateKnowledge({ ...full, contacts: [{ ...phone, type }] }, strict).ok).toBe(true);
    const emailOnly = validateKnowledge({ ...full, contacts: [{ type: "email", value: "hi@glow.rw" }, { type: "instagram", value: "@glow.rw" }] }, strict);
    expect(!emailOnly.ok && emailOnly.errors["contacts.form"]).toBe(ESSENTIALS_ERRORS.phone);
    // A mistyped number shows its own error, not a second "add a phone" message.
    const typo = validateKnowledge({ ...full, contacts: [{ ...phone, value: "123" }] }, strict);
    expect(!typo.ok && Object.keys(typo.errors)).toEqual(["contacts.0.value"]);
  });
  it("is checked by the form too (validateStep)", () => {
    const v = initialValues({ description: "x", audience: "y", tone: "z", logoUrl: null, brandColors: [], knowledge: null, country: "Rwanda" });
    expect(Object.keys(validateStep("knowledge", v)).sort()).toEqual(["contacts.form", "locations.0.address", "openingHours.form"]);
    const filled: BrandValues = { ...v, ...full };
    expect(validateStep("knowledge", filled)).toEqual({});
  });
  it("converted first-version text counts once saved in the structured form", () => {
    const v = initialValues({ description: "x", audience: "y", tone: "z", logoUrl: null, brandColors: [], country: "Rwanda", knowledge: { faqs: [], hours: "Mon-Fri 8-18", contact: "WhatsApp 0791954277" } });
    // The legacy text alone is not stored structure yet...
    expect(hasEssentials(readKnowledge({ faqs: [], hours: "Mon-Fri 8-18", contact: "WhatsApp 0791954277" }))).toBe(false);
    // ...but the converted form only needs the head office to save.
    const r = validateKnowledge(knowledgeInput({ ...v, locations: [head] }), strict);
    expect(r.ok).toBe(true);
    if (r.ok) expect(hasEssentials(readKnowledge(r.data))).toBe(true);
  });
});

describe("missingEssentials and the reminder banner", () => {
  it("lists what is missing", () => {
    expect(missingEssentials(readKnowledge({ faqs: [] }))).toEqual({ hours: true, location: true, phone: true });
    expect(missingEssentials(readKnowledge({ faqs: [], contacts: [{ type: "email", value: "a@b.co" }] })).phone).toBe(true);
  });
  it("shows for an older company without them and disappears once they are saved", () => {
    expect(EssentialsBanner({ knowledge: { faqs: [], hours: "Mon-Sat 9-18" } })).not.toBeNull();
    const done = validateKnowledge(full, strict);
    expect(done.ok && EssentialsBanner({ knowledge: done.data })).toBeNull();
  });
});
