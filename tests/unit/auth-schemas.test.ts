import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";
import {
  emailSchema,
  fieldErrors,
  organisationSchema,
  passwordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";

const org = { organisationName: "Sunrise Phones", ceoName: "Ana Silva", industry: "Other", country: "Kenya", phone: "", website: "" };
const valid = { email: " Ana@Example.com ", ...org, password: "abcdefg1", confirmPassword: "abcdefg1", terms: true as const };

describe("emailSchema", () => {
  it("trims and lowercases", () => {
    expect(emailSchema.parse(" Ana@Example.com ")).toBe("ana@example.com");
  });
  it.each(["", "nope", "a@b", "a b@c.com"])("rejects %j", (v) => {
    expect(emailSchema.safeParse(v).success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it.each(["abcdefg1", "12345678a", "Passw0rdOK"])("accepts %s", (v) => {
    expect(passwordSchema.safeParse(v).success).toBe(true);
  });
  it.each(["short1", "abcdefgh", "12345678", "", "a".repeat(73) + "1"])("rejects %j", (v) => {
    expect(passwordSchema.safeParse(v).success).toBe(false);
  });
});

describe("organisationSchema", () => {
  it("accepts the required fields and drops empty optional ones", () => {
    const r = organisationSchema.parse(org);
    expect(r.phone).toBeUndefined();
    expect(r.website).toBeUndefined();
  });

  it("requires name, CEO, industry and country", () => {
    const r = organisationSchema.safeParse({ ...org, organisationName: " ", ceoName: "", industry: "", country: "" });
    expect(r.success).toBe(false);
    expect(Object.keys(fieldErrors(r.error!)).sort()).toEqual(["ceoName", "country", "industry", "organisationName"]);
  });

  it("rejects an unknown industry or country", () => {
    expect(organisationSchema.safeParse({ ...org, industry: "Piracy" }).success).toBe(false);
    expect(organisationSchema.safeParse({ ...org, country: "Atlantis" }).success).toBe(false);
  });

  it("normalises websites and rejects bad ones", () => {
    expect(organisationSchema.parse({ ...org, website: "sunrise.example.com/" }).website).toBe("https://sunrise.example.com");
    expect(organisationSchema.parse({ ...org, website: "http://sunrise.example.com/shop" }).website).toBe("http://sunrise.example.com/shop");
    for (const bad of ["not a url", "javascript:alert(1)", "ftp://example.com", "localhost"]) {
      expect(organisationSchema.safeParse({ ...org, website: bad }).success).toBe(false);
    }
  });

  it("validates phone numbers", () => {
    expect(organisationSchema.parse({ ...org, phone: "+254 700 000 000" }).phone).toBe("+254 700 000 000");
    expect(organisationSchema.safeParse({ ...org, phone: "abc" }).success).toBe(false);
    expect(organisationSchema.safeParse({ ...org, phone: "123" }).success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("accepts a complete form and normalises the email", () => {
    expect(signUpSchema.parse(valid).email).toBe("ana@example.com");
  });

  it("requires matching passwords", () => {
    const r = signUpSchema.safeParse({ ...valid, confirmPassword: "different1" });
    expect(fieldErrors(r.error!).confirmPassword).toBe("Passwords do not match.");
  });

  it("requires accepting the terms", () => {
    expect(signUpSchema.safeParse({ ...valid, terms: false }).success).toBe(false);
    expect(fieldErrors(signUpSchema.safeParse({ ...valid, terms: false }).error!).terms).toMatch(/Terms/);
  });
});

describe("signInSchema and resetPasswordSchema", () => {
  it("needs an email and a password", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });

  it("applies the password rules and match check on reset", () => {
    expect(resetPasswordSchema.safeParse({ password: "abcdefg1", confirmPassword: "abcdefg1" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ password: "abcdefgh", confirmPassword: "abcdefgh" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "abcdefg1", confirmPassword: "abcdefg2" }).success).toBe(false);
  });
});

describe("safeNext", () => {
  it("allows same-site paths", () => {
    expect(safeNext("/dashboard/settings")).toBe("/dashboard/settings");
  });
  it.each([null, "", "//evil.com", "https://evil.com", "evil.com", "/\\evil.com"])("falls back for %j", (v) => {
    expect(safeNext(v)).toBe("/dashboard");
  });
});
