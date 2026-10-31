import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhoneInput } from "@/components/ui/phone-input";
import { businessDetailsSchema, fieldErrors, organisationSchema } from "@/lib/auth/schemas";
import { payerPhoneSchema } from "@/lib/billing/momo-shared";
import { contactSchema } from "@/lib/contact";
import { readWhatsapp } from "@/lib/creators/application";
import { normalizePhone } from "@/lib/leads/normalize";
import { requestSchema } from "@/lib/offers/shared";
import { partnerApplicationSchema } from "@/lib/partners/shared";
import { exampleNational, flagEmoji, joinPhone, NEARBY_PHONE_COUNTRIES, phoneCountryOptions, pickerCountry, typePhone } from "@/lib/phone";
import { normaliseQuotePhone } from "@/lib/quote/phone";
import { prechatWhatsapp } from "@/lib/support/client/prechat";
import { aiFromForm } from "@/lib/support/settings-form";

// The phone field every form uses (components/ui/phone-input.tsx): a flag and dial code picker, Rwanda first, and
// the number grouped as typed. Every server check must take what it posts: "+250 788 000 000".

describe("typing in the number box", () => {
  it("reads a Rwandan number with or without its 0 or +250 the same way", () => {
    for (const typed of ["0788000000", "788000000", "+250 788 000 000", "+250788000000", "00250788000000", "250788000000", "+250 0788 000 000"]) {
      expect(typePhone(typed, "RW")).toEqual({ country: "RW", national: "788 000 000" });
    }
  });

  it("drops the leading 0 as it is typed", () => {
    expect(typePhone("0", "RW")).toEqual({ country: "RW", national: "" });
    expect(typePhone("07", "RW")).toEqual({ country: "RW", national: "7" });
    expect(typePhone("0788", "RW")).toEqual({ country: "RW", national: "788" });
  });

  it("moves the picker to the country of a pasted international number", () => {
    expect(typePhone("+254 712 345 678", "RW")).toEqual({ country: "KE", national: "712 345678" });
    expect(typePhone("00254712345678", "RW")).toEqual({ country: "KE", national: "712 345678" });
    expect(typePhone("+250 791 954 277", "KE")).toEqual({ country: "RW", national: "791 954 277" });
    // A shared dial code keeps the picked country until the number says otherwise.
    expect(typePhone("+1", "CA").country).toBe("CA");
    expect(typePhone("+1", "RW").country).toBe("US");
    expect(typePhone("+1 416 555 0123", "US")).toEqual({ country: "CA", national: "416 555 0123" });
  });

  it("keeps a dial code that is still being typed", () => {
    expect(typePhone("+", "RW")).toEqual({ country: "RW", national: "+" });
    expect(typePhone("+25", "RW")).toEqual({ country: "RW", national: "+25" });
    expect(typePhone("+250", "RW")).toEqual({ country: "RW", national: "" });
  });

  it("never leaves a locked country (MoMo is Rwandan only)", () => {
    expect(typePhone("+250 788 123 456", "RW", true)).toEqual({ country: "RW", national: "788 123 456" });
    expect(typePhone("0788123456", "RW", true)).toEqual({ country: "RW", national: "788 123 456" });
    expect(typePhone("+254712345678", "RW", true).country).toBe("RW");
    expect(typePhone("+", "RW", true)).toEqual({ country: "RW", national: "" });
  });

  it("is empty for no digits", () => {
    expect(typePhone("", "RW")).toEqual({ country: "RW", national: "" });
    expect(typePhone("abc", "RW")).toEqual({ country: "RW", national: "" });
  });
});

describe("the value the form posts", () => {
  it("is the dial code and the grouped number, or empty", () => {
    expect(joinPhone({ country: "RW", national: "788 000 000" })).toBe("+250 788 000 000");
    expect(joinPhone({ country: "KE", national: "712 345678" })).toBe("+254 712 345678");
    expect(joinPhone({ country: "RW", national: "" })).toBe("");
    expect(joinPhone({ country: "RW", national: "+" })).toBe("");
    expect(joinPhone({ country: "RW", national: "+25" })).toBe("+25");
    expect(joinPhone(typePhone("0788 000 000", "RW"))).toBe("+250 788 000 000");
  });
});

describe("the country list", () => {
  it("puts Rwanda and its neighbours first, then everyone A to Z", () => {
    const options = phoneCountryOptions();
    expect(options.slice(0, 6).map((o) => o.code)).toEqual(["RW", "KE", "UG", "TZ", "BI", "CD"]);
    expect(options[0]).toEqual({ code: "RW", name: "Rwanda", dial: "+250", flag: "🇷🇼" });
    expect(options[5].name).toBe("DR Congo");
    const rest = options.slice(NEARBY_PHONE_COUNTRIES.length).map((o) => o.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, "en")));
    expect(options.length).toBeGreaterThan(200);
    expect(new Set(options.map((o) => o.code)).size).toBe(options.length);
  });

  it("draws flags and examples, and knows only real codes", () => {
    expect(flagEmoji("RW")).toBe("🇷🇼");
    expect(flagEmoji("ke")).toBe("🇰🇪");
    expect(exampleNational("RW")).toMatch(/^7\d{2} \d{3} \d{3}$/);
    expect(pickerCountry("rw")).toBe("RW");
    expect(pickerCountry("XX")).toBeNull();
    expect(pickerCountry("")).toBeNull();
  });
});

describe("the markup", () => {
  const html = (props: Parameters<typeof PhoneInput>[0]) => renderToStaticMarkup(createElement(PhoneInput, props));

  it("shows the flag and +250, the grouped number and the hidden full value", () => {
    const out = html({ name: "phone", label: "Phone", defaultValue: "+250788000000" });
    expect(out).toContain("🇷🇼");
    expect(out).toContain(">+250<");
    expect(out).toMatch(/<input[^>]*type="tel"[^>]*autoComplete="tel-national"[^>]*value="788 000 000"|<input[^>]*value="788 000 000"[^>]*/);
    expect(out).toContain('<input type="hidden" name="phone" value="+250 788 000 000"/>');
    expect(out).toMatch(/<select[^>]*aria-label="Country code"/);
    expect(out).toContain("🇷🇼 Rwanda +250</option>");
    // The label points at the number box, not the picker.
    const id = /<label[^>]*for="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toMatch(new RegExp(`<input[^>]*id="${id}"[^>]*type="tel"`));
  });

  it("starts on Rwanda, or on the country the page passes", () => {
    expect(html({ name: "phone" })).toMatch(/<option value="RW" selected="">/);
    expect(html({ name: "phone", defaultCountry: "KE" })).toMatch(/<option value="KE" selected="">/);
    expect(html({ name: "phone", defaultCountry: "KE" })).toContain('<input type="hidden" name="phone" value=""/>');
    // A stored foreign number shows its own country.
    expect(html({ name: "phone", defaultValue: "+254712345678" })).toMatch(/<option value="KE" selected="">/);
  });

  it("has no picker when the country is locked, and says the country to screen readers", () => {
    const out = html({ name: "payerPhone", lockedCountry: "RW", value: "0788123456", onChange: () => {} });
    expect(out).not.toContain("<select");
    expect(out).toContain('class="sr-only">Rwanda +250</span>');
    expect(out).toContain('<input type="hidden" name="payerPhone" value="+250 788 123 456"/>');
  });

  it("marks the field invalid and keeps the error wiring", () => {
    const out = html({ name: "phone", label: "Phone", error: "Enter a valid number.", required: true });
    expect(out).toContain('data-invalid="true"');
    expect(out).toMatch(/<input[^>]*required=""[^>]*aria-invalid="true"[^>]*aria-describedby="[^"]+-error"/);
    expect(out).toContain("Enter a valid number.");
  });
});

describe("every server check takes the posted value", () => {
  const posted = "+250 788 000 000";

  it("quote, contact, partner and custom plan forms", () => {
    expect(normaliseQuotePhone(posted)).toBe("+250788000000");
    expect(normaliseQuotePhone("+254 712 345678")).toBe("+254712345678");
    expect(contactSchema.safeParse({ kind: "done_for_you", name: "Aline", email: "a@example.com", phone: posted, message: "Hello there, we need help." }).success).toBe(true);
    expect(partnerApplicationSchema.safeParse({ kind: "agency", name: "Aline", email: "a@example.com", phone: posted, agree: "yes" }).success).toBe(true);
    expect(requestSchema.parse({ description: "We sell shoes in Kigali.", phone: posted }).phone).toBe(posted);
  });

  it("creators, leads alerts, MoMo, support chat and its admin settings", () => {
    expect(readWhatsapp(posted, "Kenya")).toBe("+250788000000");
    expect(readWhatsapp("+254 712 345678", null)).toBe("+254712345678");
    expect(normalizePhone(posted)).toBe("+250788000000");
    expect(payerPhoneSchema.parse(posted)).toBe(posted);
    expect(payerPhoneSchema.safeParse("").success).toBe(false);
    expect(prechatWhatsapp(posted)).toBe("+250788000000");
    expect(prechatWhatsapp("+254 712 345678")).toBe("+254712345678");
    expect(prechatWhatsapp("")).toBe("");
    expect(prechatWhatsapp("+254 71")).toBeNull();
    const form = new FormData();
    form.set("whatsapp", posted);
    expect(aiFromForm(form).whatsapp).toBe("+250788000000");
  });

  it("the business phone: checked against the picked country, else the business country", () => {
    const org = { organisationName: "Inzu", ceoName: "Aline", industry: "Retail", industryOther: "", industryDescription: "We sell phones and accessories in Kigali.", country: "Rwanda", website: "" };
    expect(organisationSchema.parse({ ...org, phone: posted }).phone).toBe("+250788000000");
    expect(organisationSchema.parse({ ...org, phone: posted, phoneCountry: "RW" }).phone).toBe("+250788000000");
    // Kenya picked on the field: a Kenyan line on a Rwandan company is fine.
    expect(organisationSchema.parse({ ...org, phone: "+254 712 345678", phoneCountry: "KE" }).phone).toBe("+254712345678");
    // Without the pick it is still the typo it always was, with the business country's message.
    const typo = organisationSchema.safeParse({ ...org, phone: "+254 712 345678" });
    expect(typo.success).toBe(false);
    expect(fieldErrors(typo.error!).phone).toMatch(/^Enter a valid Rwandan number/);
    // A wrong number for the picked country says that country.
    const short = organisationSchema.safeParse({ ...org, phone: "+254 71", phoneCountry: "KE" });
    expect(fieldErrors(short.error!).phone).toMatch(/^Enter a valid Kenyan number, e\.g\. \+254 /);

    const settings = businessDetailsSchema("Rwanda");
    expect(settings.parse({ organisationName: "Inzu", ceoName: "Aline", phone: posted, website: "" }).phone).toBe("+250788000000");
    expect(settings.parse({ organisationName: "Inzu", ceoName: "Aline", phone: "+254 712 345678", phoneCountry: "KE", website: "" }).phone).toBe("+254712345678");
    expect(settings.safeParse({ organisationName: "Inzu", ceoName: "Aline", phone: "+254 712 345678", website: "" }).success).toBe(false);
  });
});
