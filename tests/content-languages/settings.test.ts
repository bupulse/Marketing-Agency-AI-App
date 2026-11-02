import { describe, expect, it } from "vitest";
import { choiceText, contentLanguagesSchema, defaultContentLanguages, pickLanguage, readContentLanguages, toContentLanguage, type LanguageChoice } from "@/lib/content-languages/settings";

const mix: LanguageChoice = { mode: "mix", languages: ["English", "Kinyarwanda"] };

describe("content languages", () => {
  it("default to Kinyarwanda in Rwanda, else the content language, else English", () => {
    expect(defaultContentLanguages({ country: "Rwanda", contentLanguage: "English" }).videos).toEqual({ mode: "one", language: "Kinyarwanda" });
    expect(defaultContentLanguages({ country: "RW" }).skits).toEqual({ mode: "one", language: "Kinyarwanda" });
    expect(defaultContentLanguages({ country: "France", contentLanguage: "French" }).images).toEqual({ mode: "one", language: "French" });
    expect(defaultContentLanguages({ country: "Kenya", contentLanguage: "Klingon" }).images).toEqual({ mode: "one", language: "English" });
    expect(defaultContentLanguages({}).images).toEqual({ mode: "one", language: "English" });
  });

  it("read missing or broken parts as the default, part by part", () => {
    expect(readContentLanguages(null, { country: "Rwanda" })).toEqual(defaultContentLanguages({ country: "Rwanda" }));
    const read = readContentLanguages({ images: mix, videos: { mode: "mix", languages: ["English"] }, skits: "French" }, { country: "Rwanda" });
    expect(read.images).toEqual(mix);
    expect(read.videos).toEqual({ mode: "one", language: "Kinyarwanda" });
    expect(read.skits).toEqual({ mode: "one", language: "Kinyarwanda" });
  });

  it("validate a mix: two to four different languages", () => {
    const one = { mode: "one", language: "English" } as const;
    expect(contentLanguagesSchema.safeParse({ images: mix, videos: one, skits: one }).success).toBe(true);
    expect(contentLanguagesSchema.safeParse({ images: { mode: "mix", languages: ["English", "English"] }, videos: one, skits: one }).success).toBe(false);
    expect(contentLanguagesSchema.safeParse({ images: { mode: "mix", languages: ["English", "French", "Swahili", "Kinyarwanda", "Arabic"] }, videos: one, skits: one }).success).toBe(false);
    expect(contentLanguagesSchema.safeParse({ images: { mode: "one", language: "Klingon" }, videos: one, skits: one }).success).toBe(false);
  });

  it("pick one language a day for a mix, the same every time", () => {
    const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((dayKey) => pickLanguage(mix, { dayKey }));
    expect(new Set(days)).toEqual(new Set(["English", "Kinyarwanda"]));
    expect(days[0]).not.toBe(days[1]);
    expect(days[0]).toBe(days[2]);
    expect(pickLanguage(mix, { dayKey: "2026-11-02" })).toBe(days[0]);
    expect(pickLanguage(mix, { dayKey: "2026-11-02", offset: 1 })).toBe(days[1]);
  });

  it("follow the plan's hint when it is one of the mix", () => {
    expect(pickLanguage(mix, { dayKey: "2026-11-02", hint: "kinyarwanda" })).toBe("Kinyarwanda");
    expect(pickLanguage(mix, { dayKey: "2026-11-03", hint: "en" })).toBe("English");
    expect(pickLanguage(mix, { dayKey: "2026-11-02", hint: "French" })).toBe(pickLanguage(mix, { dayKey: "2026-11-02" }));
    expect(pickLanguage({ mode: "one", language: "Swahili" }, { dayKey: "2026-11-02", hint: "English" })).toBe("Swahili");
  });

  it("read names and codes", () => {
    expect(toContentLanguage("rw")).toBe("Kinyarwanda");
    expect(toContentLanguage(" FRENCH ")).toBe("French");
    expect(toContentLanguage("xx")).toBeNull();
    expect(choiceText(mix)).toBe("Mix: English, Kinyarwanda");
  });
});
