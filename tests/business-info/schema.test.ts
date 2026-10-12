import { describe, expect, it } from "vitest";
import { initialValues } from "@/components/brand-profile/initial";
import { knowledgeInput } from "@/components/brand-profile/steps";
import { readKnowledge, validateKnowledge } from "@/lib/brand/schemas";
import { knowledgeFacts } from "@/lib/business-info/facts";

const profile = { description: "Bakery", audience: "Families", tone: "friendly", logoUrl: null, brandColors: [], country: "Rwanda" };

describe("stored knowledge, old and new", () => {
  it("reads first-version free text unchanged", () => {
    const k = readKnowledge({ hours: "Mon to Sat, 9am to 6pm", area: "Kigali", contact: "Call 0791954277", faqs: [] });
    expect(k).toMatchObject({ hours: "Mon to Sat, 9am to 6pm", area: "Kigali", contact: "Call 0791954277", openingHours: [], locations: [], contacts: [] });
    // The marketing writers still see the text.
    expect(knowledgeFacts(k)).toEqual({ hours: "Mon to Sat, 9am to 6pm", area: "Kigali", contact: "Call 0791954277" });
  });
  it("keeps the valid parts of damaged JSON", () => {
    const k = readKnowledge({
      hours: 42,
      faqs: [{ question: "Q", answer: "A" }, { question: "" }],
      openingHours: "nope",
      contacts: [{ type: "whatsapp", value: "+250791954277", primary: true }, { type: "whatsapp", value: "javascript:alert(1)" }, { type: "fax", value: "1" }],
      locations: [{ kind: "head", address: "KG 7 Ave, Kigali", mapsUrl: "https://evil.example" }],
    });
    expect(k.hours).toBeUndefined();
    expect(k.faqs).toEqual([{ question: "Q", answer: "A" }]);
    expect(k.openingHours).toEqual([]);
    expect(k.contacts).toEqual([{ type: "whatsapp", value: "+250791954277", primary: true }]);
    // The map link is always rebuilt from the address.
    expect(k.locations[0].mapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=KG\+7\+Ave/);
    expect(readKnowledge(null).contacts).toEqual([]);
    expect(readKnowledge("text").faqs).toEqual([]);
  });
  it("drops stored hours that contradict themselves", () => {
    expect(readKnowledge({ faqs: [], openingHours: [{ days: ["mon"], open: "18:00", close: "08:00" }] }).openingHours).toEqual([]);
  });
});

describe("initialValues converts old text for the editors", () => {
  it("turns readable hours and contacts into structured values", () => {
    const v = initialValues({ ...profile, knowledge: { hours: "Mon-Fri 8-18", contact: "WhatsApp 0791954277", faqs: [] } });
    expect(v.openingHours).toEqual([{ days: ["mon", "tue", "wed", "thu", "fri"], open: "08:00", close: "18:00" }]);
    expect(v.hours).toBe("");
    expect(v.contacts).toEqual([{ type: "whatsapp", value: "+250 791 954 277", country: "Rwanda", primary: true }]);
    expect(v.contact).toBe("");
    expect(v.locations).toEqual([{ kind: "head", label: "", address: "" }]);
  });
  it("keeps unreadable text as notes", () => {
    const v = initialValues({ ...profile, knowledge: { hours: "Most days, ring first", contact: "Ask at the market stall", faqs: [] } });
    expect(v.openingHours).toEqual([]);
    expect(v.hours).toBe("Most days, ring first");
    expect(v.contacts).toEqual([]);
    expect(v.contact).toBe("Ask at the market stall");
  });
  it("round-trips through validation to the same stored value", () => {
    const stored = {
      faqs: [],
      openingHours: [{ days: ["mon", "tue", "wed", "thu", "fri"], open: "08:00", close: "18:00" }],
      locations: [{ kind: "head", label: "Main shop", address: "KG 7 Ave, Kigali", placeId: "ChIJabcdefghij", lat: -1.95, lng: 30.06 }],
      contacts: [{ type: "whatsapp_call", value: "+250791954277", primary: true }, { type: "instagram", value: "glow.rw" }, { type: "website", value: "https://glow.rw" }],
    };
    const r = validateKnowledge(knowledgeInput(initialValues({ ...profile, knowledge: stored })), { country: "Rwanda" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.openingHours).toEqual(stored.openingHours);
      expect(r.data.contacts).toEqual(stored.contacts);
      expect(r.data.locations?.[0]).toMatchObject({ kind: "head", label: "Main shop", placeId: "ChIJabcdefghij", lat: -1.95, lng: 30.06 });
    }
  });
});

describe("validateKnowledge (shared by the form and the server action)", () => {
  const base = { faqs: [] };
  it("reports hours errors on the right set", () => {
    const r = validateKnowledge({ ...base, openingHours: [{ days: ["mon"], open: "09:00", close: "17:00" }, { days: ["mon", "tue"], open: "18:00", close: "08:00" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors["openingHours.1.days"]).toMatch(/Monday/);
      expect(r.errors["openingHours.1.close"]).toBeTruthy();
    }
  });
  it("needs the head office before branches and ignores blank branches", () => {
    const r = validateKnowledge({ ...base, locations: [{ kind: "head", address: "" }, { kind: "branch", address: "Musanze" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["locations.0.address"]).toMatch(/head office/);
    const ok = validateKnowledge({ ...base, locations: [{ kind: "head", address: "Kigali" }, { kind: "branch", address: "  " }] });
    expect(ok.ok && ok.data.locations).toEqual([{ kind: "head", address: "Kigali", mapsUrl: "https://www.google.com/maps/search/?api=1&query=Kigali" }]);
  });
  it("drops coordinates without a place id and refuses forged place ids", () => {
    const r = validateKnowledge({ ...base, locations: [{ kind: "head", address: "Kigali", placeId: "<script>", lat: 1, lng: 2 }] });
    expect(r.ok && r.data.locations?.[0]).toEqual({ kind: "head", address: "Kigali", mapsUrl: "https://www.google.com/maps/search/?api=1&query=Kigali" });
  });
  it("normalises contacts, uses the business country by default and keeps one main contact", () => {
    const r = validateKnowledge(
      {
        ...base,
        contacts: [
          { type: "phone", value: "0791954277" },
          { type: "email", value: "", primary: true },
          { type: "instagram", value: "https://instagram.com/Glow.RW", primary: true },
          { type: "whatsapp", value: "0712345678", country: "Kenya", primary: true },
        ],
      },
      { country: "Rwanda" },
    );
    expect(r.ok && r.data.contacts).toEqual([
      { type: "phone", value: "+250791954277" },
      { type: "instagram", value: "glow.rw", primary: true },
      { type: "whatsapp", value: "+254712345678" },
    ]);
  });
  it("marks the first contact as main when none is", () => {
    const r = validateKnowledge({ ...base, contacts: [{ type: "email", value: "a@b.co" }] });
    expect(r.ok && r.data.contacts).toEqual([{ type: "email", value: "a@b.co", primary: true }]);
  });
  it("reports a bad contact under its own row", () => {
    const r = validateKnowledge({ ...base, contacts: [{ type: "email", value: "" }, { type: "whatsapp", value: "123", country: "Rwanda" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["contacts.1.value"]);
  });
  it("answers a validation error, never a crash, for crafted input", () => {
    const crafted: unknown[] = [
      null,
      "text",
      { hours: 5, faqs: [] },
      { faqs: "nope" },
      { contacts: [{ type: "email", value: 42 }] },
      { contacts: "x" },
      { locations: [{ kind: "head", address: { toString: "x" } }] },
      { openingHours: [{ days: ["funday"], open: "08:00", close: "18:00" }] },
      { openingHours: [{ days: ["mon"], open: 800, close: "18:00" }] },
      { faqs: [{ question: ["q"], answer: "a" }] },
    ];
    for (const input of crafted) {
      const r = validateKnowledge(input as never);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.form).toMatch(/could not be read/);
    }
  });
  it("still accepts the first version's input", () => {
    const r = validateKnowledge({ hours: "Mon-Sat 9-18", area: "Kigali", contact: "Call us", faqs: [] });
    expect(r).toEqual({ ok: true, data: { hours: "Mon-Sat 9-18", area: "Kigali", contact: "Call us", faqs: [] } });
  });
});
