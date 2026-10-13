// People in the pictures (owner decision, 13 October 2026): posts almost always show people, who look local to the
// client's market and fit its customers. The art director writes a structured "people" brief: age band, gender and
// role from fixed lists (adults only), plus a short activity, place, mood and framing; this file checks it, fills it
// from the company's country and personas when it is missing, and turns it into the scene for the image model. Every
// free-text part goes through `safePhrase`. Pure, so it is unit tested. The main guard is the prompt rule in
// lib/designs/prompt.ts; this filtering is the second line.
import { z } from "zod";
import { countries } from "@/lib/content/countries";
import { cleanScene } from "@/lib/designs/photo-scene";

export const AGE_BANDS = ["18-25", "26-40", "41-60", "60+"] as const;
export const GENDERS = ["woman", "man", "mixed group"] as const;
export const ROLES = ["customer", "staff", "family adults", "team", "professional"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const peopleSchema = z.object({
  age: z.enum(AGE_BANDS).describe("The adults' age band"),
  gender: z.enum(GENDERS).describe("One woman, one man, or a small mixed group of adults"),
  role: z.enum(ROLES).describe("Who they are for the business"),
  activity: z.string().describe("What they are doing with the product or service, e.g. 'holding the phone and smiling at a message'"),
  where: z.string().describe("Where, in the client's market, e.g. 'a cafe terrace in Kigali'"),
  mood: z.string().describe("The mood, e.g. 'warm, relaxed'"),
  framing: z.string().describe("The framing, e.g. 'medium close-up, product clearly visible'"),
});

export type PeopleBrief = z.infer<typeof peopleSchema>;

export interface Audience {
  /** Business.country, as the sign-up form stores it ("Rwanda"). */
  country?: string | null;
  /** Customers & audience personas, most important first. */
  personas: { ageRange: string; gender?: string | null; location?: string | null; occupation?: string | null }[];
}

const LIMITS = { activity: 140, where: 120, mood: 60, framing: 80 } as const;

// Words that would put a minor, nudity, a medical claim or a real person in the picture: removed from any free text.
const NOT_ALLOWED = new RegExp(
  "\\b(" +
    [
      "celebrit(?:y|ies)", "famous", "look-?alikes?", "influencers?",
      "child(?:ren)?", "kids?", "bab(?:y|ies)", "toddlers?", "teen(?:ager)?s?", "schoolchildren", "girls?", "boys?", "sons?", "daughters?", "students?", "pupils?", "minors?", "young",
      "nude", "naked", "topless", "shirtless", "sexy", "lingerie", "bikinis?", "swimsuits?", "underwear",
      "before[- ]and[- ]after", "weight[- ]loss", "surgery", "injections?", "patients?",
    ].join("|") +
    ")\\b",
  "gi",
);

// A public figure: the title and the name after it go together ("President Kagame", "the singer Meddy").
const PUBLIC_FIGURE = /\b(?:the\s+)?(?:president|prime minister|minister|king|queen|prince|princess|celebrity|singer|actor|actress|footballer|politician|rapper|pastor|bishop|mayor|governor|senator|general)\b(?:\s+(?:of\s+)?[\p{L}'.-]+){0,3}/giu;

/** Free text from the AI or the owner, made safe for an image prompt: one line, no fences, no unsafe words or public figures, clipped at a word. */
export function safePhrase(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/[\u0000-\u001f\u007f]/g, " ");
  while (/<{3,}|>{3,}/.test(text)) text = text.replace(/<{3,}|>{3,}/g, "");
  text = text.replace(PUBLIC_FIGURE, " ").replace(NOT_ALLOWED, " ").replace(/\s+/g, " ").replace(/\s+([,.;])/g, "$1").replace(/^[\s,.;:-]+|[\s,;:-]+$/g, "").trim();
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max);
  return text.slice(0, cut > max / 2 ? cut : max).trim();
}

const COUNTRY_NAMES = new Map(countries.map((c) => [c.toLowerCase(), c]));

/** The country from the sign-up list ("rwanda " → "Rwanda"); anything else is not used in a prompt. */
export function knownCountry(country?: string | null): string | null {
  return COUNTRY_NAMES.get((country ?? "").trim().toLowerCase()) ?? null;
}

// How people and places are named for the markets BuPulse serves first; any other known country is named as it is.
const LOCAL: Record<string, { people: string; place: string }> = {
  Rwanda: { people: "Rwandan", place: "Kigali" },
  Kenya: { people: "Kenyan", place: "Nairobi" },
  Uganda: { people: "Ugandan", place: "Kampala" },
  Tanzania: { people: "Tanzanian", place: "Dar es Salaam" },
  Burundi: { people: "Burundian", place: "Bujumbura" },
  Nigeria: { people: "Nigerian", place: "Lagos" },
  Ghana: { people: "Ghanaian", place: "Accra" },
  "South Africa": { people: "South African", place: "Johannesburg" },
};

/** "Rwandan" people in "Kigali" for Rwanda; "local" people in "Peru" for another known country; nothing raw. */
export function localLook(country?: string | null): { people: string; place: string } {
  const known = knownCountry(country);
  if (known && LOCAL[known]) return LOCAL[known];
  return known ? { people: "local", place: known } : { people: "local", place: "the business's town" };
}

const AGE_WORDS: Record<AgeBand, string> = { "18-25": "aged 18 to 25", "26-40": "aged 26 to 40", "41-60": "aged 41 to 60", "60+": "over 60" };
const ROLE_WORDS: Record<(typeof ROLES)[number], string> = { customer: "a customer", staff: "a staff member", "family adults": "adult family members", team: "the business's team", professional: "a professional at work" };

/** The art director's brief, checked: unknown list values get safe defaults, free text is made safe. Null when unusable. */
export function readPeople(raw: unknown): PeopleBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (list.includes(value as T) ? (value as T) : fallback);
  const brief: PeopleBrief = {
    age: pick(AGE_BANDS, r.age, "26-40"),
    gender: pick(GENDERS, r.gender, "mixed group"),
    role: pick(ROLES, r.role, "customer"),
    activity: safePhrase(r.activity, LIMITS.activity),
    where: safePhrase(r.where, LIMITS.where),
    mood: safePhrase(r.mood, LIMITS.mood),
    framing: safePhrase(r.framing, LIMITS.framing),
  };
  return brief.activity || AGE_BANDS.includes(r.age as AgeBand) ? brief : null;
}

/** The persona's age range (lib/knowledge/audience.ts) as an adult band; under-18 and "all ages" give adults. */
export function ageBand(ageRange?: string | null): AgeBand {
  if (ageRange === "18-24") return "18-25";
  if (ageRange === "45-54" || ageRange === "55-64") return "41-60";
  if (ageRange === "65+") return "60+";
  return "26-40";
}

/** The brief BuPulse writes itself when the art director gave none: the company's customers, in its market. */
export function defaultPeople(audience: Audience | undefined, subject: string, doing?: string | null): PeopleBrief {
  const look = localLook(audience?.country);
  const p = audience?.personas[0];
  const thing = safePhrase(subject, 60) || "what the business offers";
  return {
    age: ageBand(p?.ageRange),
    gender: p?.gender === "female" ? "woman" : p?.gender === "male" ? "man" : "mixed group",
    role: "customer",
    // A content pack's angle says what they do ("a staff member explaining the steps to a client").
    activity: doing ? `${safePhrase(doing, 100)}, with ${thing}` : `using or enjoying ${thing}`,
    where: `an everyday ${look.place} setting`,
    mood: "warm, natural",
    framing: "medium shot, the product or service clearly visible",
  };
}

/** "a woman aged 26 to 40, a customer" (adults only, from the lists). */
export function whoText(b: Pick<PeopleBrief, "age" | "gender" | "role">): string {
  const person = b.gender === "mixed group" ? `a small mixed group of adults ${AGE_WORDS[b.age]}` : `a ${b.gender} ${AGE_WORDS[b.age]}`;
  return `${person}, ${ROLE_WORDS[b.role]}`;
}

/**
 * The scene for the image model: realistic local adults doing something with the product, where, in what mood and
 * framing. With a reference photo the real product stays recognisable. Cleaned of words that would make the model
 * paint text (lib/designs/photo-scene.ts cleanScene).
 */
export function peopleScene(brief: PeopleBrief | null, audience: Audience | undefined, subject: string, hasReference: boolean, scene = "", doing?: string | null): string {
  const b = brief ?? defaultPeople(audience, subject, doing);
  const look = localLook(audience?.country);
  const parts = [
    `${whoText(b)}, ${look.people === "local" ? `who look like local people in ${look.place}` : `${look.people} people in natural everyday clothes`}`,
    b.activity || `using ${safePhrase(subject, 60)}`,
    b.where ? `in ${b.where.replace(/^(in|at)\s+/i, "")}` : `in an everyday ${look.place} setting`,
    b.mood ? `mood ${b.mood}` : "",
    b.framing ? `framing ${b.framing}` : "",
    // What the art director wants in the picture besides the people (product, props, place).
    scene && scene !== subject ? safePhrase(scene, 200) : "",
    hasReference ? "the product from the reference photo appears exactly as it is and stays clearly recognisable" : "",
  ];
  return cleanScene(parts.filter(Boolean).join("; ")).slice(0, 600);
}
