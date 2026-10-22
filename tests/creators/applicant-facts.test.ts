import { describe, expect, it } from "vitest";
import { accountFor, answerLines, factsOf, followerCheck, followerCheckInWords, matchState, sortByMatch, storedAnswers, uploadAnswers } from "@/lib/creators/applicant-facts";
import { brandLook, brandVars } from "@/lib/creators/brand-look";
import { formatsInWords, requirementsInWords } from "@/lib/creators/describe";
import { defaultForm, PRESET_FIELDS, type ApplicationForm, type FormField } from "@/lib/creators/form-fields";
import { readRequirements } from "@/lib/creators/requirements";

// What the company's Applicants list shows (lib/creators/applicant-facts.ts): answers read back and in words, the
// match against the requirements (matches first), and the followers a connected account verifies.

const preset = (id: string) => PRESET_FIELDS.find((f) => f.id === id)!;
const upload: FormField = { id: "intro", type: "UPLOAD", accept: "VIDEO", label: "Your intro video", required: false };
const pay: FormField = { id: "pay", type: "MONEY_RANGE", label: "Your price", required: false };
const form: ApplicationForm = { ...defaultForm(), fields: [preset("location"), preset("languages"), preset("niches"), upload, pay] };

describe("answers as stored", () => {
  it("reads every shape back and leaves out the rest", () => {
    expect(storedAnswers({ a: "x", b: ["y"], c: 3, d: { min: 1, max: 2 }, e: { from: "2026-11-01", to: "2026-11-02" }, f: { nope: 1 }, g: [1] })).toEqual({ a: "x", b: ["y"], c: 3, d: { min: 1, max: 2 }, e: { from: "2026-11-01", to: "2026-11-02" } });
    expect(storedAnswers(null)).toEqual({});
  });

  it("puts them in words in the form's order, uploads as their signed link", () => {
    const answers = { pay: { min: 5_000, max: 20_000 }, intro: "applications/c1/a.mp4", location: "Kigali", languages: ["English", "French"] };
    expect(uploadAnswers(form.fields, answers)).toEqual(["applications/c1/a.mp4"]);
    expect(answerLines(form, answers, new Map([["applications/c1/a.mp4", "https://signed/a"]]), "RWF")).toEqual([
      { id: "location", label: "Where do you live?", text: "Kigali" },
      { id: "languages", label: "Which languages do you post in?", text: "English, French" },
      { id: "intro", label: "Your intro video", text: "File sent", file: "https://signed/a" },
      { id: "pay", label: "Your price", text: "5,000 - 20,000 RWF" },
    ]);
    // A file the clean-up removed: the line stays, without a link.
    expect(answerLines(form, { intro: "applications/c1/gone.mp4" }, new Map(), "RWF")[0].file).toBeNull();
  });
});

describe("matching", () => {
  const req = readRequirements({ locations: ["Kigali"], languages: ["Kinyarwanda"], minFollowers: 1_000 });

  it("builds the facts from the presets, the profile's place when the form did not ask", () => {
    expect(factsOf(form, { location: "Kigali, Gasabo", languages: ["Kinyarwanda"], niches: ["Food and drinks"] }, [1_200])).toEqual({ followers: [1_200], location: "Kigali, Gasabo", languages: ["Kinyarwanda"], niches: ["Food and drinks"] });
    expect(factsOf(defaultForm(), {}, [], "Musanze")).toEqual({ followers: [], location: "Musanze", languages: null, niches: null });
  });

  it("says Matches, what was not given, or Doesn't match and why", () => {
    expect(matchState(req, { followers: [1_200], location: "Kigali, Gasabo", languages: ["Kinyarwanda"] })).toEqual({ kind: "match", misses: [], unknown: [] });
    expect(matchState(req, { followers: [1_200], location: "Kigali" })).toMatchObject({ kind: "unknown", unknown: ["Languages not given"] });
    expect(matchState(req, { followers: [300], location: "Musanze", languages: ["English"] })).toMatchObject({ kind: "miss", misses: ["Fewer than 1,000 followers", "Not in Kigali", "Doesn't post in Kinyarwanda"] });
    expect(matchState(readRequirements(null), { followers: [] }).kind).toBe("none");
  });

  it("puts those who match first, keeping the order otherwise", () => {
    const state = { a: "miss", b: "match", c: "unknown", d: "match" } as const;
    expect(sortByMatch(["a", "b", "c", "d", "e"], (id) => (id in state ? { kind: state[id as keyof typeof state], misses: [], unknown: [] } : undefined))).toEqual(["b", "d", "e", "c", "a"]);
  });
});

describe("followers a connected account verifies", () => {
  const accounts = [
    { network: "instagram", username: "@ana.rw", displayName: "@ana.rw", followers: 12_300 },
    { network: "facebook", username: "Ana Styles", displayName: "Ana Styles", followers: 900 },
    { network: "facebook", username: "Ana Food", displayName: "Ana Food", followers: 50 },
  ];

  it("finds the account by network and name, or the only one on the network", () => {
    expect(accountFor({ network: "instagram", handle: "someoneelse" }, accounts)?.followers).toBe(12_300);
    expect(accountFor({ network: "facebook", handle: "ana food" }, accounts)?.followers).toBe(50);
    expect(accountFor({ network: "facebook", handle: "other page" }, accounts)).toBeNull();
    expect(accountFor({ network: "tiktok", handle: "ana" }, accounts)).toBeNull();
  });

  it("says Verified, or what they said against what they have", () => {
    expect(followerCheck(12_000, 12_300)).toEqual({ kind: "verified", has: 12_300 });
    expect(followerCheck(13_000, 12_300)?.kind).toBe("verified");
    expect(followerCheck(20_000, 12_300)).toEqual({ kind: "differs", said: 20_000, has: 12_300 });
    expect(followerCheck(20_000, null)).toBeNull();
    expect(followerCheckInWords({ kind: "verified", has: 12_300 })).toBe("12,300 followers · Verified");
    expect(followerCheckInWords({ kind: "differs", said: 20_000, has: 12_300 })).toBe("Said 20,000 · has 12,300");
  });
});

describe("words for creators deciding", () => {
  it("says who the campaign looks for and what to post", () => {
    expect(requirementsInWords(readRequirements({ locations: ["Kigali"], minFollowers: 1_000, languages: ["Kinyarwanda"], niches: ["Food and drinks", "Fashion", "Comedy"] }))).toEqual(["Kigali", "1,000+ followers", "Kinyarwanda", "Food and drinks, Fashion and more"]);
    expect(requirementsInWords(readRequirements(null))).toEqual([]);
    expect(formatsInWords(["REEL", "STORY", "NOPE"])).toEqual(["Reel / short video", "Story"]);
  });
});

describe("the application page's look", () => {
  it("takes the brand colours, with readable text on the first", () => {
    expect(brandLook(["#FFD400", "#111111"])).toEqual({ brand: "#FFD400", brand2: "#111111", onBrand: "#0B0B0F" });
    expect(brandLook(["#0A3D62"]).onBrand).toBe("#FFFFFF");
    expect(brandLook(["nope"])).toEqual({ brand: "#2F6BFF", brand2: "#7B5CFF", onBrand: "#FFFFFF" });
    expect(brandVars(brandLook([]))).toEqual({ "--brand": "#2F6BFF", "--brand-2": "#7B5CFF", "--on-brand": "#FFFFFF" });
  });
});
