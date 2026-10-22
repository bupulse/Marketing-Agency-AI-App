import { describe, expect, it } from "vitest";
import { legacyForm, readApplication, readFields, readSocials, splitName, type ApplicationErrors } from "@/lib/creators/application";
import { defaultForm, PRESET_FIELDS, type ApplicationForm, type FormField } from "@/lib/creators/form-fields";
import { quickApplyAsks, readQuickApplication } from "@/lib/creators/quick-apply-form";

// The application form a company builds (docs/CREATOR_CAMPAIGN_WIZARD.md, "Form") as /c/<slug> sends it, read by
// lib/creators/application.ts; and one-tap applying against it (lib/creators/quick-apply-form.ts).

const post = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

const field = (f: Partial<FormField> & Pick<FormField, "id" | "type">): FormField => ({ label: `Question ${f.id}`, required: false, ...f });

const BASICS: [string, string][] = [
  ["firstName", " Ana "],
  ["lastName", "Uwase"],
  ["email", "Ana@Example.com"],
  ["phone", "0791 954 277"],
  ["networks", "instagram"],
  ["handle_instagram", "@ana.rw"],
  ["followers_instagram", "12k"],
];
const campaign = (form: ApplicationForm) => ({ platforms: ["instagram"], questions: [], country: "Rwanda", form });

describe("the built application form", () => {
  it("reads first and last name into one name, the email, the WhatsApp number and the accounts", () => {
    const r = readApplication(post(BASICS), campaign(defaultForm()));
    expect(r).toEqual({ ok: true, value: { name: "Ana Uwase", email: "ana@example.com", phone: "+250791954277", handles: [{ network: "instagram", handle: "ana.rw", followers: 12_000 }], samples: [], answers: {} } });
  });

  it("asks for both names", () => {
    const r = readApplication(post([...BASICS.filter(([k]) => k !== "lastName"), ["lastName", " "]]), campaign(defaultForm()));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ lastName: "Enter your last name." });
  });

  it("follows the company's choice for the phone and the best posts", () => {
    const noPhone = BASICS.filter(([k]) => k !== "phone");
    expect(readApplication(post(noPhone), campaign({ ...defaultForm(), phone: "OPTIONAL" }))).toMatchObject({ ok: true, value: { phone: null } });
    expect(readApplication(post([...noPhone, ["phone", "12"]]), campaign({ ...defaultForm(), phone: "OPTIONAL" }))).toMatchObject({ ok: false, errors: { phone: expect.any(String) } });
    expect(readApplication(post(BASICS), campaign({ ...defaultForm(), phone: "HIDDEN" }))).toMatchObject({ ok: true, value: { phone: null } });
    expect(readApplication(post(noPhone), campaign(defaultForm()))).toMatchObject({ ok: false, errors: { phone: expect.any(String) } });

    expect(readApplication(post(BASICS), campaign({ ...defaultForm(), samples: "REQUIRED" }))).toMatchObject({ ok: false, errors: { sample_1: expect.any(String) } });
    expect(readApplication(post([...BASICS, ["sample_1", "https://www.tiktok.com/@ana/video/1"]]), campaign({ ...defaultForm(), samples: "HIDDEN" }))).toMatchObject({ ok: true, value: { samples: [] } });
    expect(readApplication(post([...BASICS, ["sample_1", "tiktok.com/x"]]), campaign(defaultForm()))).toMatchObject({ ok: false, errors: { sample_1: expect.any(String) } });
  });

  it("takes accounts on any network, at least one, each ticked one with a username", () => {
    const errors: ApplicationErrors = {};
    const handles = readSocials(post([["networks", "youtube"], ["handle_youtube", "@anachannel"], ["followers_youtube", "1.5M"], ["networks", "linkedin"], ["handle_linkedin", "https://www.linkedin.com/in/ana-uwase"], ["followers_linkedin", "800"]]), errors);
    expect(errors).toEqual({});
    expect(handles).toEqual([
      { network: "youtube", handle: "anachannel", followers: 1_500_000 },
      { network: "linkedin", handle: "https://www.linkedin.com/in/ana-uwase", followers: 800 },
    ]);
    const missing: ApplicationErrors = {};
    expect(readSocials(post([["networks", "tiktok"]]), missing)).toEqual([]);
    expect(missing).toEqual({ handle_tiktok: "Enter your TikTok username." });
    const none: ApplicationErrors = {};
    readSocials(post([]), none);
    expect(none).toEqual({ handles: "Add at least one of your accounts." });
    // Not on the campaign's platforms is fine: the company sees which ones are.
    expect(readApplication(post([...BASICS.slice(0, 4), ["networks", "snapchat"], ["handle_snapchat", "ana"], ["followers_snapchat", "300"]]), campaign(defaultForm())).ok).toBe(true);
  });

  it("reads every field type, ranges and several choices included", () => {
    const fields: FormField[] = [
      field({ id: "a", type: "SHORT_TEXT", required: true }),
      field({ id: "b", type: "LONG_TEXT" }),
      field({ id: "c", type: "SINGLE_CHOICE", options: ["Morning", "Evening"] }),
      field({ id: "d", type: "MULTI_CHOICE", options: ["Kinyarwanda", "English", "French"] }),
      field({ id: "e", type: "DROPDOWN", options: ["Gasabo", "Kicukiro"] }),
      field({ id: "f", type: "YES_NO" }),
      field({ id: "g", type: "NUMBER", min: 1, max: 100 }),
      field({ id: "h", type: "MONEY_RANGE", max: 1_000_000 }),
      field({ id: "i", type: "SCALE", min: 1, max: 5 }),
      field({ id: "j", type: "DATE" }),
      field({ id: "k", type: "DATE_RANGE" }),
      field({ id: "l", type: "UPLOAD", accept: "VIDEO" }),
      field({ id: "m", type: "LINK" }),
      field({ id: "n", type: "LOCATION" }),
    ];
    const errors: ApplicationErrors = {};
    const answers = readFields(
      post([
        ["q_a", " Hi "],
        ["q_b", "Long\nanswer"],
        ["q_c", "Evening"],
        ["q_d", "Kinyarwanda"],
        ["q_d", "French"],
        ["q_e", "Gasabo"],
        ["q_f", "yes"],
        ["q_g", "42"],
        ["q_h.min", "5,000"],
        ["q_h.max", "20000"],
        ["q_i", "4"],
        ["q_j", "2026-11-02"],
        ["q_k.from", "2026-11-01"],
        ["q_k.to", "2026-11-30"],
        ["q_l", "applications/c1/x.mp4"],
        ["q_l.name", "me.mp4"],
        ["q_m", "https://example.com/me"],
        ["q_n", "Kigali, Gasabo"],
      ]),
      fields,
      errors,
    );
    expect(errors).toEqual({});
    expect(answers).toEqual({ a: "Hi", b: "Long\nanswer", c: "Evening", d: ["Kinyarwanda", "French"], e: "Gasabo", f: "yes", g: 42, h: { min: 5_000, max: 20_000 }, i: 4, j: "2026-11-02", k: { from: "2026-11-01", to: "2026-11-30" }, l: "applications/c1/x.mp4", m: "https://example.com/me", n: "Kigali, Gasabo" });

    const bad: ApplicationErrors = {};
    readFields(post([["q_c", "Noon"], ["q_g", "500"], ["q_h.min", "9"], ["q_h.max", "3"], ["q_k.from", "2026-11-30"], ["q_k.to", "2026-11-01"], ["q_m", "nope"]]), fields, bad);
    expect(Object.keys(bad).sort()).toEqual(["q_a", "q_c", "q_g", "q_h", "q_k", "q_m"]);
    expect(bad.q_a).toBe("Please answer this question.");
  });

  it("keeps campaigns made before the wizard working: one name box, questions, a best post required", () => {
    const legacy = legacyForm([{ id: "why", label: "Why you?", required: true }]);
    expect(legacy.samples).toBe("REQUIRED");
    expect(legacy.fields).toEqual([{ id: "why", type: "LONG_TEXT", label: "Why you?", required: true }]);
    const old = new Map(Object.entries({ name: "Ana Uwase", email: "a@b.rw", phone: "+250791954277", handle_instagram: "ana", followers_instagram: "100", sample_1: "https://www.instagram.com/p/x/", q_why: "Because" }));
    expect(readApplication(old, { platforms: ["instagram"], questions: [{ id: "why", label: "Why you?", required: true }], country: "Rwanda" })).toMatchObject({ ok: true, value: { name: "Ana Uwase", answers: { why: "Because" } } });
  });

  it("splits one name into first and last", () => {
    expect(splitName("Ana Marie Uwase")).toEqual({ firstName: "Ana Marie", lastName: "Uwase" });
    expect(splitName(" Ana ")).toEqual({ firstName: "Ana", lastName: "" });
  });
});

describe("one-tap applying with the built form", () => {
  const location = PRESET_FIELDS.find((f) => f.id === "location")!;
  const languages = PRESET_FIELDS.find((f) => f.id === "languages")!;
  const why = field({ id: "why", type: "LONG_TEXT" });
  const form: ApplicationForm = { ...defaultForm(), fields: [location, languages, why] };
  const profile = { name: "Ana Uwase", phone: "+250791954277", location: "Kigali, Gasabo", samples: ["https://www.instagram.com/p/x/"] };

  it("asks only the required fields the profile cannot answer, and the optional ones folded", () => {
    expect(quickApplyAsks(form, profile)).toEqual({ fields: [languages], optional: [why], samples: false });
    expect(quickApplyAsks({ ...form, fields: [location] }, profile)).toEqual({ fields: [], optional: [], samples: false });
    expect(quickApplyAsks({ ...form, fields: [location] }, { ...profile, location: null }).fields).toEqual([location]);
    expect(quickApplyAsks({ ...form, samples: "REQUIRED", fields: [] }, { ...profile, samples: [] }).samples).toBe(true);
  });

  it("fills the application from the profile, with what the short form sent taking over", () => {
    const r = readQuickApplication(post([["q_languages", "English"], ["firstName", "Anna"], ["lastName", "Uwase"]]), form, profile, "Rwanda");
    expect(r).toEqual({ ok: true, value: { name: "Anna Uwase", phone: "+250791954277", samples: ["https://www.instagram.com/p/x/"], answers: { location: "Kigali, Gasabo", languages: ["English"] } } });
    // Typed over the profile's place.
    expect(readQuickApplication(post([["q_languages", "English"], ["q_location", "Musanze"]]), form, profile, "Rwanda")).toMatchObject({ ok: true, value: { name: "Ana Uwase", answers: { location: "Musanze" } } });
  });

  it("says what is missing, and respects a hidden phone", () => {
    expect(readQuickApplication(post([]), form, profile, "Rwanda")).toEqual({ ok: false, errors: { q_languages: "Please answer this question." } });
    expect(readQuickApplication(post([["q_languages", "French"]]), { ...form, phone: "HIDDEN" }, profile, "Rwanda")).toMatchObject({ ok: true, value: { phone: null } });
    expect(readQuickApplication(post([["q_languages", "French"], ["phone", "nope"]]), form, profile, "Rwanda")).toMatchObject({ ok: false, errors: { phone: expect.any(String) } });
  });
});
