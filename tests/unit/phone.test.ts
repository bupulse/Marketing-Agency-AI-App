import { describe, expect, it } from "vitest";
import { dialCode, examplePhone, formatAsYouType, formatPhone, isValidPhone, phoneCountry, phoneErrorMessage, toE164, toInternational } from "@/lib/phone";

// The country select drives the dial code, the as-you-type grouping and the validation; the stored form is E.164.

describe("phoneCountry and dialCode", () => {
  it("maps sign-up country names to dial codes", () => {
    expect(dialCode(phoneCountry("Rwanda"))).toBe("+250");
    expect(dialCode(phoneCountry("Kenya"))).toBe("+254");
    expect(dialCode(phoneCountry("Portugal"))).toBe("+351");
    expect(dialCode(phoneCountry("United States"))).toBe("+1");
    expect(dialCode(phoneCountry("Atlantis"))).toBe("");
    expect(dialCode(null)).toBe("");
  });
});

describe("formatAsYouType", () => {
  it("groups a Rwandan number as it is typed and keeps the dial code", () => {
    const RW = phoneCountry("Rwanda");
    expect(formatAsYouType("7", RW)).toBe("+250 7");
    expect(formatAsYouType("791", RW)).toBe("+250 791");
    expect(formatAsYouType("791954277", RW)).toBe("+250 791 954 277");
  });

  it.each(["0791954277", "791954277", "+250791954277", "+250 791 954 277", "00250791954277", "250791954277", "(0791) 954-277"])("normalises the pasted variant %j", (pasted) => {
    expect(formatAsYouType(pasted, phoneCountry("Rwanda"))).toBe("+250 791 954 277");
  });

  it("formats Kenyan, Portuguese and US numbers in their own grouping", () => {
    // Groupings are libphonenumber's international formats (Kenya keeps 3+6 digits).
    expect(formatAsYouType("0712345678", phoneCountry("Kenya"))).toBe("+254 712 345678");
    expect(formatAsYouType("912345678", phoneCountry("Portugal"))).toBe("+351 912 345 678");
    expect(formatAsYouType("2015550123", phoneCountry("United States"))).toBe("+1 201 555 0123");
  });

  it("keeps a foreign number typed with its own dial code", () => {
    expect(formatAsYouType("+254712345678", phoneCountry("Rwanda"))).toBe("+254 712 345678");
  });

  it("is empty for no digits", () => {
    expect(formatAsYouType("", phoneCountry("Rwanda"))).toBe("");
    expect(formatAsYouType("abc", phoneCountry("Rwanda"))).toBe("");
    expect(toInternational("", null)).toBe("");
  });
});

describe("validation and storage", () => {
  it("stores valid numbers as E.164 for the chosen country", () => {
    expect(toE164("0791954277", phoneCountry("Rwanda"))).toBe("+250791954277");
    expect(toE164("+250 791 954 277", phoneCountry("Rwanda"))).toBe("+250791954277");
    expect(toE164("0712 345 678", phoneCountry("Kenya"))).toBe("+254712345678");
    expect(toE164("912 345 678", phoneCountry("Portugal"))).toBe("+351912345678");
    expect(toE164("(201) 555-0123", phoneCountry("United States"))).toBe("+12015550123");
  });

  it("rejects numbers that are too short, too long or from another country", () => {
    const RW = phoneCountry("Rwanda");
    expect(isValidPhone("0791", RW)).toBe(false);
    expect(isValidPhone("07919542771234", RW)).toBe(false);
    expect(isValidPhone("abc", RW)).toBe(false);
    // A Kenyan number on a Rwandan form is a typo, not a valid Rwandan phone.
    expect(isValidPhone("+254712345678", RW)).toBe(false);
    expect(isValidPhone("+254712345678", phoneCountry("Kenya"))).toBe(true);
    // A US local number without area code is not valid.
    expect(isValidPhone("5550123", phoneCountry("United States"))).toBe(false);
  });

  it("without a known country accepts any valid international number only", () => {
    expect(toE164("+250791954277", null)).toBe("+250791954277");
    expect(toE164("0791954277", null)).toBeNull();
  });
});

describe("display", () => {
  it("formats a stored E.164 number for people", () => {
    expect(formatPhone("+250791954277")).toBe("+250 791 954 277");
    expect(formatPhone("+12015550123")).toBe("+1 201 555 0123");
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("not a number")).toBe("not a number");
  });

  it("writes the error with the country's adjective and an example", () => {
    expect(phoneErrorMessage("Rwanda")).toBe(`Enter a valid Rwandan number, e.g. ${examplePhone(phoneCountry("Rwanda"))}.`);
    expect(phoneErrorMessage("Rwanda")).toMatch(/\+250 \d{3} \d{3} \d{3}/);
    expect(phoneErrorMessage("Kenya")).toMatch(/^Enter a valid Kenyan number, e\.g\. \+254 /);
    expect(phoneErrorMessage("Portugal")).toMatch(/^Enter a valid Portuguese number, e\.g\. \+351 /);
    expect(phoneErrorMessage("Fiji")).toMatch(/^Enter a valid number for Fiji, e\.g\. \+679 /);
    expect(phoneErrorMessage("")).toMatch(/^Enter a valid phone number/);
  });
});
