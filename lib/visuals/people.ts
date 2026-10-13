// People in the pictures (owner decision, 13 October 2026): posts almost always show people, who look local to the
// client's market and fit its customers. The art director writes a short "people" brief (who, doing what, where,
// mood, framing); this file checks it, fills it from the company's country and personas when it is missing, and turns
// it into the scene for the image model. Pure, so it is unit tested. Safety rules live in lib/designs/prompt.ts.
import { z } from "zod";
import { cleanScene } from "@/lib/designs/photo-scene";

export const peopleSchema = z.object({
  who: z.string().describe("Who is in the photo: one to three everyday local people that fit the customers, e.g. 'a woman in her thirties, an office worker'"),
  doing: z.string().describe("What they are doing with the product or service, e.g. 'holding the phone and smiling at a message'"),
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

const LIMITS: Record<keyof PeopleBrief, number> = { who: 140, doing: 140, where: 120, mood: 60, framing: 80 };

// How people and places are named for the markets BuPulse serves first; any other country is named as it is.
const LOCAL: Record<string, { people: string; place: string }> = {
  rwanda: { people: "Rwandan", place: "Kigali" },
  kenya: { people: "Kenyan", place: "Nairobi" },
  uganda: { people: "Ugandan", place: "Kampala" },
  tanzania: { people: "Tanzanian", place: "Dar es Salaam" },
  burundi: { people: "Burundian", place: "Bujumbura" },
  "democratic republic of the congo": { people: "Congolese", place: "Goma" },
  nigeria: { people: "Nigerian", place: "Lagos" },
  ghana: { people: "Ghanaian", place: "Accra" },
  "south africa": { people: "South African", place: "Johannesburg" },
};

/** "Rwandan people in Kigali settings" for Rwanda; "local people in Peru" for a country not in the list. */
export function localLook(country?: string | null): { people: string; place: string } {
  const key = (country ?? "").trim().toLowerCase();
  const known = LOCAL[key];
  if (known) return known;
  return key ? { people: "local", place: (country ?? "").trim().slice(0, 60) } : { people: "local", place: "the business's town" };
}

/** One line of text from the AI or the owner, made safe: no fences, no control characters, clipped at a word. */
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/[\u0000-\u001f\u007f]/g, " ");
  while (/<{3,}|>{3,}/.test(text)) text = text.replace(/<{3,}|>{3,}/g, "");
  text = text.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : text.slice(0, text.lastIndexOf(" ", max) > max / 2 ? text.lastIndexOf(" ", max) : max).trim();
}

// Words that would make the picture about a real person, or unsafe for an advert, are dropped from the brief.
const NOT_ALLOWED = /\b(celebrit(y|ies)|famous|look-?alike|president|minister|politician|footballer|singer|actor|actress|influencer|child(ren)?|kids?|baby|babies|toddlers?|teen(ager)?s?|nude|naked|lingerie|bikini|before[- ]and[- ]after|weight[- ]loss|surgery|injection|patients?)\b/gi;

/** The art director's brief, checked: every part clipped and cleaned. Null when it says nothing usable. */
export function readPeople(raw: unknown): PeopleBrief | null {
  const parsed = peopleSchema.partial().safeParse(raw);
  if (!parsed.success) return null;
  const out = Object.fromEntries((Object.keys(LIMITS) as (keyof PeopleBrief)[]).map((k) => [k, clean(parsed.data[k], LIMITS[k]).replace(NOT_ALLOWED, "").replace(/\s+/g, " ").trim()])) as PeopleBrief;
  return out.who || out.doing ? out : null;
}

const AGE: Record<string, string> = { "18-24": "in their early twenties", "25-34": "in their late twenties or thirties", "35-44": "in their late thirties or forties", "45-54": "in their late forties or fifties", "55-64": "in their late fifties or sixties", "65+": "in their sixties or seventies" };

function personaPeople(audience: Audience | undefined, look: { people: string }): string {
  const p = audience?.personas[0];
  if (!p) return `one or two ${look.people} adults of different ages, everyday customers`;
  // "All ages" and under-18 personas still give adults: no children in the pictures.
  const age = AGE[p.ageRange];
  const who = p.gender === "female" ? "women" : p.gender === "male" ? "men" : age ? "people" : "adults";
  const job = p.occupation ? clean(p.occupation, 40).replace(NOT_ALLOWED, "").trim() : "";
  return `one or two ${look.people} ${who}${age ? ` ${age}` : ""}${job ? `, such as a ${job}` : ""}`;
}

/** The brief BuPulse writes itself when the art director gave none: the company's customers, in its market. */
export function defaultPeople(audience: Audience | undefined, subject: string): PeopleBrief {
  const look = localLook(audience?.country);
  return {
    who: personaPeople(audience, look),
    doing: `using or enjoying ${clean(subject, 60) || "what the business offers"}`,
    where: `an everyday ${look.place} setting`,
    mood: "warm, natural",
    framing: "medium shot, the product or service clearly visible",
  };
}

/**
 * The scene for the image model: realistic local people doing something with the product, where, in what mood and
 * framing. With a reference photo the real product stays recognisable. Cleaned of words that would make the model
 * paint text (lib/designs/photo-scene.ts cleanScene).
 */
export function peopleScene(brief: PeopleBrief | null, audience: Audience | undefined, subject: string, hasReference: boolean, scene = ""): string {
  const b = brief ?? defaultPeople(audience, subject);
  const look = localLook(audience?.country);
  const parts = [
    `${b.who || personaPeople(audience, look)}, ${look.people === "local" ? `who look like local people in ${look.place}` : `${look.people} people in natural everyday clothes`}`,
    b.doing || `using ${subject}`,
    b.where ? `in ${b.where.replace(/^(in|at)\s+/i, "")}` : `in an everyday ${look.place} setting`,
    b.mood ? `mood ${b.mood}` : "",
    b.framing ? `framing ${b.framing}` : "",
    // What the art director wants in the picture besides the people (product, props, place).
    scene && scene !== subject ? clean(scene, 200).replace(NOT_ALLOWED, "").trim() : "",
    hasReference ? "the product from the reference photo appears exactly as it is and stays clearly recognisable" : "",
  ];
  return cleanScene(parts.filter(Boolean).join("; ")).slice(0, 600);
}
