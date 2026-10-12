import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";
import {
  businessDetailsSchema,
  emailSchema,
  fieldErrors,
  industrySchema,
  organisationSchema,
  passwordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  welcomeSchema,
} from "@/lib/auth/schemas";

const org = {
  organisationName: "Sunrise Phones",
  ceoName: "Ana Silva",
  industry: "other",
  industryOther: "Phone repairs",
  industryDescription: "We repair and sell phones and accessories in Nairobi CBD.",
  country: "Kenya",
  phone: "",
  website: "",
};
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

  it("requires name, CEO, sector, description and country", () => {
    const r = organisationSchema.safeParse({ ...org, organisationName: " ", ceoName: "", industry: "", industryDescription: "", country: "" });
    expect(r.success).toBe(false);
    expect(Object.keys(fieldErrors(r.error!)).sort()).toEqual(["ceoName", "country", "industry", "industryDescription", "organisationName"]);
  });

  it("Other requires the owner's industry text; a listed sector does not", () => {
    const r = organisationSchema.safeParse({ ...org, industry: "other", industryOther: "  " });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!)).toEqual({ industryOther: "Tell us your industry." });
    expect(organisationSchema.safeParse({ ...org, industry: "retail", industryOther: "" }).success).toBe(true);
    // The "Other" check runs even when another field failed, so the person sees every problem at once.
    const both = organisationSchema.safeParse({ ...org, industry: "other", industryOther: "", ceoName: "" });
    expect(Object.keys(fieldErrors(both.error!)).sort()).toEqual(["ceoName", "industryOther"]);
  });

  it("requires a description of 20 to 500 characters", () => {
    expect(fieldErrors(organisationSchema.safeParse({ ...org, industryDescription: "Too short" }).error!).industryDescription).toMatch(/at least 20/);
    expect(organisationSchema.safeParse({ ...org, industryDescription: "x".repeat(501) }).success).toBe(false);
    expect(organisationSchema.safeParse({ ...org, industryDescription: "x".repeat(500) }).success).toBe(true);
  });

  it("rejects an unknown country", () => {
    expect(organisationSchema.safeParse({ ...org, country: "Atlantis" }).success).toBe(false);
  });

  it("normalises websites and rejects bad ones", () => {
    expect(organisationSchema.parse({ ...org, website: "sunrise.example.com/" }).website).toBe("https://sunrise.example.com");
    expect(organisationSchema.parse({ ...org, website: "http://sunrise.example.com/shop" }).website).toBe("http://sunrise.example.com/shop");
    for (const bad of ["not a url", "javascript:alert(1)", "ftp://example.com", "localhost"]) {
      expect(organisationSchema.safeParse({ ...org, website: bad }).success).toBe(false);
    }
  });

  it("validates the phone for the chosen country and stores E.164", () => {
    expect(organisationSchema.parse({ ...org, phone: "+254 712 345 678" }).phone).toBe("+254712345678");
    expect(organisationSchema.parse({ ...org, phone: "0712 345 678" }).phone).toBe("+254712345678");
    expect(organisationSchema.parse({ ...org, country: "Rwanda", phone: "0791954277" }).phone).toBe("+250791954277");
    expect(organisationSchema.parse({ ...org, country: "Portugal", phone: "912 345 678" }).phone).toBe("+351912345678");
    expect(organisationSchema.parse({ ...org, country: "United States", phone: "(201) 555-0123" }).phone).toBe("+12015550123");
    // "+250..." is a Rwandan number on a Kenyan form: a typo, not a Kenyan phone.
    for (const bad of ["abc", "123", "07123", "+250791954277"]) {
      const r = organisationSchema.safeParse({ ...org, phone: bad });
      expect(r.success).toBe(false);
      expect(fieldErrors(r.error!).phone).toMatch(/^Enter a valid Kenyan number, e\.g\. \+254 /);
    }
    expect(fieldErrors(organisationSchema.safeParse({ ...org, country: "Rwanda", phone: "0712345678" }).error!).phone).toMatch(/^Enter a valid Rwandan number, e\.g\. \+250 /);
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

describe("welcomeSchema", () => {
  it("accepts organisation details with the terms and no password", () => {
    expect(welcomeSchema.safeParse({ ...org, terms: true }).success).toBe(true);
  });

  it("requires the terms and the required organisation fields", () => {
    const r = welcomeSchema.safeParse({ ...org, organisationName: "", terms: false });
    expect(r.success).toBe(false);
    expect(Object.keys(fieldErrors(r.error!)).sort()).toEqual(["organisationName", "terms"]);
  });

  it("applies the Other and phone checks too", () => {
    const r = welcomeSchema.safeParse({ ...org, industryOther: "", phone: "abc", terms: true });
    expect(Object.keys(fieldErrors(r.error!)).sort()).toEqual(["industryOther", "phone"]);
    expect(welcomeSchema.parse({ ...org, phone: "0712345678", terms: true }).phone).toBe("+254712345678");
  });
});

describe("businessDetailsSchema and industrySchema", () => {
  it("checks the phone against the company's saved country, with no country or sector fields", () => {
    const s = businessDetailsSchema("Rwanda");
    expect(s.parse({ organisationName: "Inzu", ceoName: "Aline", phone: "0791954277", website: "" }).phone).toBe("+250791954277");
    expect(fieldErrors(s.safeParse({ organisationName: "Inzu", ceoName: "Aline", phone: "0712345678", website: "" }).error!).phone).toMatch(/Rwandan/);
    expect(Object.keys(s.parse({ organisationName: "Inzu", ceoName: "Aline", phone: "", website: "" })).sort()).toEqual(["ceoName", "organisationName", "phone", "website"]);
  });

  it("industrySchema: Other needs the text, the description is required", () => {
    expect(industrySchema.safeParse({ industry: "retail", industryOther: "", industryDescription: org.industryDescription }).success).toBe(true);
    expect(fieldErrors(industrySchema.safeParse({ industry: "other", industryOther: "", industryDescription: org.industryDescription }).error!)).toEqual({ industryOther: "Tell us your industry." });
    expect(fieldErrors(industrySchema.safeParse({ industry: "retail", industryOther: "", industryDescription: "" }).error!).industryDescription).toMatch(/Describe your business/);
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
  it("keeps the query string", () => {
    expect(safeNext("/dashboard/brand?tab=voice")).toBe("/dashboard/brand?tab=voice");
  });
  it.each([null, "", "//evil.com", "https://evil.com", "evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/%09/evil.com".replace("%09", "\t")])("falls back for %j", (v) => {
    expect(safeNext(v)).toBe("/dashboard");
  });
});
