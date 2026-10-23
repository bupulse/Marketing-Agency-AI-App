// The image engine's catalogue (docs/IMAGE_ENGINE.md): the ad patterns a picture can follow, and the shots, lights and
// layouts it can use. The Director (director.ts) combines them so that no two pictures of a batch, and no picture of the
// last weeks, share the same idea. Pure and client-safe.

export type Treatment = "exact" | "scale" | "line";

export type Pattern = {
  id: string;
  label: string;
  /** What the picture shows, for the Prompter. */
  idea: string;
  /** How the product is shown: as it is, many of them in a bigger setting, or a new item of the same product line. */
  treatment: Treatment;
  /** People in the picture: "yes" (part of the idea), "no" (product only) or "maybe". */
  people: "yes" | "no" | "maybe";
  /** Only when the business has this fact: real customer reviews, a price or an offer. */
  needs?: "reviews" | "price";
};

export const PATTERNS: readonly Pattern[] = [
  { id: "outcome", label: "The result", idea: "The happy result the product gives a customer: the moment they enjoy what they gained.", treatment: "exact", people: "yes" },
  { id: "in-use", label: "In use", idea: "Hands and people using the product in its real setting, close and authentic.", treatment: "exact", people: "yes" },
  { id: "at-scale", label: "At scale", idea: "Many of the product working together in a big, busy, professional setting with a team at work.", treatment: "scale", people: "yes" },
  { id: "product-line", label: "New in the range", idea: "A new item of the same product line: the same materials, colours, logo and design language in a new shape or size, shown in use.", treatment: "line", people: "maybe" },
  { id: "hero", label: "Hero shot", idea: "The product alone as the star, in a striking set with bold light and colour.", treatment: "exact", people: "no" },
  { id: "before-after", label: "Before and after", idea: "Two halves: the situation without the product, then with it (never bodies, health or faces).", treatment: "exact", people: "maybe" },
  { id: "old-vs-new", label: "Old way vs new way", idea: "Side by side: the usual way people do it, and the better way with the product.", treatment: "exact", people: "maybe" },
  { id: "testimonial", label: "Customer words", idea: "A real customer's portrait with a short quote from one of the business's real reviews.", treatment: "exact", people: "yes", needs: "reviews" },
  { id: "features", label: "Feature callouts", idea: "The product with two or three short labels pointing to its real selling points.", treatment: "exact", people: "no" },
  { id: "problem-solution", label: "Problem, solved", idea: "The everyday problem the customer has, visibly solved by the product.", treatment: "exact", people: "yes" },
  { id: "behind-scenes", label: "Behind the scenes", idea: "The team preparing, making or delivering the product, real and warm.", treatment: "exact", people: "yes" },
  { id: "flat-lay", label: "Flat lay", idea: "An overhead arrangement of the product with things that belong to its story.", treatment: "exact", people: "no" },
  { id: "moment", label: "Local moment", idea: "The product in a seasonal or local moment of the customer's life (a market day, rainy season, a celebration).", treatment: "exact", people: "yes" },
  { id: "crowd", label: "Popular", idea: "A busy, lively scene with many customers around the product, showing it is popular.", treatment: "scale", people: "yes" },
  { id: "offer", label: "The offer", idea: "A bold, simple offer ad: the product big, the real price or offer clear.", treatment: "exact", people: "no", needs: "price" },
  { id: "how-it-works", label: "How it works", idea: "A clear explainer: the product with simple numbered steps or a cut-away showing how it works.", treatment: "exact", people: "no" },
  { id: "delivery", label: "Arrives", idea: "The product arriving: delivery, opening it, the first moment with it.", treatment: "exact", people: "yes" },
  { id: "detail", label: "Detail", idea: "An extreme close-up of the product's material, texture and quality.", treatment: "exact", people: "no" },
];

export const SHOTS = ["close-up", "medium shot", "wide establishing shot", "overhead top-down", "low angle hero", "over-the-shoulder", "eye-level portrait"] as const;
/** Light with a real source (anti-slop, docs/IMAGE_ANTI_SLOP.md: no neon haze, no "cinematic" glow). */
export const LIGHTS = ["low late-afternoon sun", "soft morning daylight through a window", "plain daylight in an open shop or workshop", "warm tungsten bulbs in the evening", "flat overcast daylight", "low side light through an open door", "midday sun with hard shadows"] as const;
/** Where the words sit: every picture lays them out differently, no template. */
export const LAYOUTS = [
  "big headline across the top, button at the bottom left",
  "headline in a bold band along the bottom",
  "split frame: words on a solid brand-colour panel on one side, picture on the other",
  "short centred headline over a calm area, button centred below",
  "words in a column down the left side",
  "headline in the top right corner, small line under it, button bottom right",
  "magazine cover style: large headline behind the subject",
  "sticker or badge style labels around the product",
] as const;

export const patternById = (id: string) => PATTERNS.find((p) => p.id === id);
