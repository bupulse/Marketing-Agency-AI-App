// The Seedance brain (docs/VIDEO_ENGINE.md, "Seedance brain"): what makes a Seedance 2.0 clip good for a Rwandan
// business ad, as data and pure functions, no AI. Claude's prompt writer (seedance-prompt.ts) gets the rules and the
// camera words in its system prompt and a starting shot plan in its brief; the studio uses the same plan for instant
// previews and as the prompt when Claude is unavailable.
// Sources: the BytePlus Seedance 2.0 prompt guide (subject + action + place + light + camera + sound, one camera move
// per shot, time-coded multi-shot prompts, references by number, no on-screen text), Higgsfield's Marketing Studio
// presets (docs/research/VIDEO_COMPETITORS_TEARDOWN.md) and the TikTok patterns (docs/research/reels/tiktok-patterns.md:
// hook inside 3 s, a cut every 2-3 s, demo before persuasion, the result first in before/after).
import { SEEDANCE_LIMITS, SEEDANCE_MODELS, SEEDANCE_RATIOS, estimateSeedanceUsd, type SeedanceRequest } from "./seedance";

// ---- (a) Shot types and camera language Seedance responds to

/** `short` is used for a repeated shot type, or everywhere when a prompt must be compacted to fit 160 words. */
export type ShotType = { id: string; name: string; words: string; short: string; use: string };
export const SHOT_TYPES: ShotType[] = [
  { id: "ecu", name: "Extreme close-up", words: "extreme close-up", short: "extreme close-up", use: "a label, a stitch, a screen edge, steam" },
  { id: "macro", name: "Macro", words: "macro shot, shallow depth of field", short: "macro", use: "drops, fabric weave, sizzle, texture" },
  { id: "cu", name: "Close-up", words: "close-up", short: "close-up", use: "the product in a hand, a reaction" },
  { id: "mcu", name: "Medium close-up", words: "medium close-up, chest up", short: "medium close-up", use: "a presenter talking to camera" },
  { id: "ms", name: "Medium shot", words: "medium shot, waist up", short: "medium shot", use: "a person using or wearing the product" },
  { id: "ws", name: "Wide shot", words: "wide shot", short: "wide shot", use: "the shop, the room, the venue" },
  { id: "ews", name: "Establishing shot", words: "wide establishing shot", short: "establishing shot", use: "the street, the building, the hills" },
  { id: "top", name: "Top-down", words: "overhead top-down shot", short: "top-down shot", use: "food on a table, a flat-lay, unboxing on a desk" },
  { id: "low", name: "Low angle", words: "low-angle shot", short: "low-angle shot", use: "a product or building that should look big" },
  { id: "pov", name: "POV", words: "first-person POV shot, hands in frame", short: "POV shot", use: "unboxing, choosing, trying" },
  { id: "ots", name: "Over the shoulder", words: "over-the-shoulder shot", short: "over-the-shoulder shot", use: "someone looking at a screen, a menu, a mirror" },
  { id: "selfie", name: "Selfie", words: "handheld selfie-style shot at arm's length", short: "selfie shot", use: "UGC testimonials" },
  { id: "hero", name: "Hero end shot", words: "clean hero shot, subject centred", short: "hero shot", use: "the last 1-2 s; BuPulse adds the text on top later" },
];

/** `short` is used when the same move comes back in a later shot (the prompt stays within 160 words). */
export type CameraMove = { id: string; words: string; short: string; feel: string };
export const CAMERA_LANGUAGE: CameraMove[] = [
  { id: "static", words: "locked-off static camera", short: "static camera", feel: "calm; lets the action speak" },
  { id: "push-in", words: "slow push-in", short: "slow push-in", feel: "focus, desire, a reveal" },
  { id: "pull-out", words: "slow pull-back revealing the scene", short: "slow pull-back", feel: "context, an ending" },
  { id: "orbit", words: "slow orbit around the subject", short: "slow orbit", feel: "premium, shows the product in 3D" },
  { id: "pan", words: "smooth pan from left to right", short: "slow pan", feel: "a row of products, a room" },
  { id: "tilt-up", words: "slow tilt up", short: "tilt up", feel: "revealing a building or an outfit" },
  { id: "tracking", words: "tracking shot following the subject", short: "tracking shot", feel: "energy, movement" },
  { id: "gimbal", words: "smooth gimbal walk-through", short: "gimbal walk-through", feel: "house, venue and shop tours" },
  { id: "crane-up", words: "crane up and over", short: "crane up", feel: "a grand opening or ending" },
  { id: "drone", words: "slow aerial drone shot", short: "drone shot", feel: "property, location, events" },
  { id: "handheld", words: "natural handheld phone camera with a slight shake", short: "handheld", feel: "UGC, honest, TikTok" },
  { id: "whip-pan", words: "fast whip pan", short: "whip pan", feel: "an energetic change between two shots" },
  { id: "rack-focus", words: "rack focus from the foreground to the subject", short: "rack focus", feel: "guides the eye" },
  { id: "dolly-zoom", words: "dolly zoom", short: "dolly zoom", feel: "the 'wow' moment (once per clip)" },
  { id: "slow-motion", words: "in slow motion", short: "slow motion", feel: "pours, splashes, hair, fabric" },
];

const SHOT_PATTERNS: [RegExp, string][] = [
  [/extreme close-?up/i, "ecu"],
  [/macro/i, "macro"],
  [/overhead|top-down|flat-?lay/i, "top"],
  [/selfie/i, "selfie"],
  [/\bpov\b|first-person/i, "pov"],
  [/over[- ]the[- ]shoulder/i, "ots"],
  [/low[- ]?angle/i, "low"],
  [/hero shot/i, "hero"],
  [/medium close/i, "mcu"],
  [/close-?up/i, "cu"],
  [/medium shot|waist up/i, "ms"],
  [/establishing|aerial/i, "ews"],
  [/\bwide\b/i, "ws"],
];
const CAMERA_PATTERNS: [RegExp, string][] = [
  [/dolly zoom|vertigo/i, "dolly-zoom"],
  [/whip/i, "whip-pan"],
  [/rack focus|focus (pull|slides|moves|shifts)/i, "rack-focus"],
  [/drone|aerial/i, "drone"],
  [/gimbal|walk-?through/i, "gimbal"],
  [/crane/i, "crane-up"],
  [/orbit|arc shot|circles? around/i, "orbit"],
  [/\btilt/i, "tilt-up"],
  [/tracking|follows?\b|following/i, "tracking"],
  [/\bpans?\b|panning/i, "pan"],
  [/push(es)?[- ]?in|dolly in|zoom(s)? in|moves? closer/i, "push-in"],
  [/pull(s)?[- ]?(back|out)|dolly out|zoom(s)? out/i, "pull-out"],
  [/handheld|selfie/i, "handheld"],
  [/slow[- ]motion/i, "slow-motion"],
  [/static|locked|tripod|fixed camera|still camera/i, "static"],
];
const shotById = (id: string) => SHOT_TYPES.find((s) => s.id === id) ?? SHOT_TYPES[4];
const cameraById = (id: string) => CAMERA_LANGUAGE.find((c) => c.id === id) ?? CAMERA_LANGUAGE[0];
/** The shot type a piece of prompt text describes (null when it names none). */
export const detectShotType = (text: string): ShotType | null => {
  const hit = SHOT_PATTERNS.find(([re]) => re.test(text));
  return hit ? shotById(hit[1]) : null;
};
/** The camera move a piece of prompt text describes (null when it names none). */
export const detectCamera = (text: string): CameraMove | null => {
  const hit = CAMERA_PATTERNS.find(([re]) => re.test(text));
  return hit ? cameraById(hit[1]) : null;
};

// ---- (b) Prompt templates by business type and format

export const BUSINESS_KINDS = [
  { id: "shop", name: "Shop", words: "a local shop" },
  { id: "restaurant", name: "Restaurant or café", words: "a restaurant" },
  { id: "salon", name: "Salon or barber", words: "a hair salon" },
  { id: "phone-shop", name: "Phone and electronics shop", words: "a phone shop" },
  { id: "real-estate", name: "Real estate", words: "a real-estate listing" },
  { id: "fashion", name: "Fashion boutique", words: "a fashion boutique" },
  { id: "events", name: "Events and venues", words: "an event" },
  { id: "services", name: "Services (cleaning, repair, garage)", words: "a local service business" },
  { id: "education", name: "School or training", words: "a school" },
] as const;
export type BusinessKind = (typeof BUSINESS_KINDS)[number]["id"];

export const SEEDANCE_FORMATS = [
  { id: "product-reveal", name: "Product reveal", words: "product reveal ad" },
  { id: "ugc-testimonial", name: "UGC testimonial", words: "UGC-style testimonial ad filmed on a phone" },
  { id: "before-after", name: "Before and after", words: "before-and-after ad (the result first)" },
  { id: "unboxing", name: "Unboxing", words: "unboxing ad" },
  { id: "tour", name: "Tour", words: "walk-through tour ad" },
  { id: "offer", name: "Offer", words: "offer announcement ad" },
] as const;
export type SeedanceFormat = (typeof SEEDANCE_FORMATS)[number]["id"];

/** Spoken lines, filled only with facts from the brief. Kinyarwanda and Swahili get no line (see the language rule). */
type SayKey = "intro" | "found" | "usp" | "price" | "cta" | "visit" | "book" | "learn";
const LINES: Record<SayKey, { en: string; fr: string; needs?: "price" | "usp" }> = {
  intro: { en: "{product}, at {business}.", fr: "{product}, chez {business}." },
  found: { en: "Look what I found at {business}!", fr: "Regardez ce que j'ai trouvé chez {business} !" },
  usp: { en: "{usp}.", fr: "{usp}.", needs: "usp" },
  price: { en: "{product}: {price}.", fr: "{product} : {price}.", needs: "price" },
  cta: { en: "Order yours at {business}.", fr: "Commandez le vôtre chez {business}." },
  visit: { en: "Come and see us at {business}.", fr: "Venez nous voir chez {business}." },
  book: { en: "Book your spot at {business}.", fr: "Réservez chez {business}." },
  learn: { en: "I'm learning at {business}.", fr: "J'apprends chez {business}." },
};

/**
 * One shot of a template. Placeholders: {P} the product (the first mention names its reference), {product} "the
 * <name>", {name} the bare name, {presenter} (described once, then "the presenter"), {place}. Visual text never carries prices or names: the video has no text.
 */
export type SeedanceBeat = { weight: number; shot: string; camera: string; action: string; sound?: string; say?: SayKey[]; optional?: boolean };
export type SeedanceTemplate = {
  id: string;
  name: string;
  business: (BusinessKind | "any")[];
  format: SeedanceFormat;
  seconds: number;
  /** A fictional presenter appears; `cast` describes one when the brief names none. */
  presenter?: boolean;
  cast?: string;
  place: string;
  light: string;
  music: string;
  beats: SeedanceBeat[];
};

const S = (t: SeedanceTemplate) => t;
const FICTIONAL_WOMAN = "a friendly fictional Rwandan woman in her twenties";
const FICTIONAL_MAN = "a friendly fictional Rwandan man in his twenties";

export const SEEDANCE_TEMPLATES: SeedanceTemplate[] = [
  // ---- Shops
  S({ id: "shop-new-stock", name: "New stock reveal", business: ["shop"], format: "product-reveal", seconds: 8, place: "a tidy shop counter in a Kigali shop", light: "bright, clean daylight", music: "upbeat Afrobeat groove",
    beats: [
      { weight: 2, shot: "cu", camera: "push-in", action: "a hand pulls a cloth off {P} on the counter in one quick move", sound: "a soft whoosh" },
      { weight: 3, shot: "cu", camera: "orbit", action: "{P} turns slowly on the counter, light gliding over it", sound: "a light shimmer" },
      { weight: 2, shot: "macro", camera: "rack-focus", action: "the finish and details of {P}, focus sliding across them", optional: true },
      { weight: 2, shot: "hero", camera: "static", action: "{P} centred on the counter, the shop softly blurred behind, space above it", say: ["price", "intro"] },
    ] }),
  S({ id: "shop-ugc-find", name: "I found this", business: ["shop"], format: "ugc-testimonial", seconds: 10, presenter: true, cast: FICTIONAL_WOMAN, place: "the aisle of a busy Kigali shop", light: "natural shop light", music: "light, happy beat under the voice",
    beats: [
      { weight: 2, shot: "selfie", camera: "handheld", action: "{presenter} walks into the shop holding the phone camera, excited", say: ["found"] },
      { weight: 3, shot: "cu", camera: "handheld", action: "{presenter} picks {P} up from the shelf and shows it to the camera" },
      { weight: 2, shot: "ms", camera: "handheld", action: "{presenter} tries {product}, nods and smiles", optional: true },
      { weight: 2, shot: "hero", camera: "static", action: "{P} held close to the lens, {presenter} smiling behind it, slightly blurred", say: ["usp", "cta"] },
    ] }),
  S({ id: "shop-offer", name: "Offer of the week", business: ["shop"], format: "offer", seconds: 8, place: "a colourful, well-stocked Kigali shop", light: "bright, punchy light", music: "energetic drum groove",
    beats: [
      { weight: 2, shot: "ws", camera: "whip-pan", action: "a fast reveal of full, colourful shelves", sound: "a whoosh and a drum hit" },
      { weight: 3, shot: "cu", camera: "push-in", action: "{P} slides into the centre of the counter" },
      { weight: 3, shot: "hero", camera: "static", action: "{P} under a soft spotlight, still and clean, space above it", say: ["price", "cta"] },
    ] }),
  // ---- Restaurants and cafés
  S({ id: "restaurant-dish-hero", name: "Dish close-up", business: ["restaurant"], format: "product-reveal", seconds: 8, place: "a warm wooden restaurant table in Kigali", light: "warm golden light, steam catching the light", music: "relaxed acoustic guitar",
    beats: [
      { weight: 2, shot: "macro", camera: "slow-motion", action: "steam rises from {P}, the sauce glistening", sound: "a soft sizzle" },
      { weight: 2, shot: "top", camera: "static", action: "hands set {product} down on the table" },
      { weight: 2, shot: "cu", camera: "orbit", action: "{product} from every side, fresh and sharp", optional: true },
      { weight: 2, shot: "hero", camera: "push-in", action: "{product} centred, the warm room blurred behind", say: ["price", "intro"] },
    ] }),
  S({ id: "restaurant-menu-tour", name: "Weekly menu tour", business: ["restaurant"], format: "tour", seconds: 12, place: "a cosy Kigali restaurant with tables set and warm lights on", light: "warm evening light", music: "relaxed Afro-jazz",
    beats: [
      { weight: 3, shot: "ws", camera: "gimbal", action: "the camera glides through {place}", sound: "gentle chatter and cutlery" },
      { weight: 2, shot: "cu", camera: "tracking", action: "a server carries {P} past the camera" },
      { weight: 2, shot: "macro", camera: "slow-motion", action: "a fork lifts the first bite of {product}" },
      { weight: 2, shot: "ms", camera: "handheld", action: "a fictional adult customer tastes it and smiles, eyes closed", optional: true },
      { weight: 2, shot: "hero", camera: "static", action: "{product} on the table, the room glowing behind", say: ["visit"] },
    ] }),
  S({ id: "restaurant-ugc-taste", name: "Taste test", business: ["restaurant"], format: "ugc-testimonial", seconds: 10, presenter: true, cast: FICTIONAL_MAN, place: "a busy Kigali café table", light: "soft window light", music: "low café ambience",
    beats: [
      { weight: 2, shot: "selfie", camera: "handheld", action: "{presenter} sits down and turns the camera to {P}", say: ["found"] },
      { weight: 3, shot: "cu", camera: "handheld", action: "{presenter} takes the first bite of {product}, eyes widening" },
      { weight: 2, shot: "mcu", camera: "handheld", action: "{presenter} laughs and nods to the camera", optional: true },
      { weight: 2, shot: "hero", camera: "static", action: "{product} on the table in sharp focus, {presenter} smiling behind", say: ["usp", "intro"] },
    ] }),
  S({ id: "restaurant-offer", name: "Lunch deal", business: ["restaurant"], format: "offer", seconds: 8, place: "a lively Kigali restaurant at lunchtime", light: "bright midday light", music: "upbeat Afrobeat",
    beats: [
      { weight: 2, shot: "top", camera: "whip-pan", action: "a whip across the table onto {P}", sound: "a whoosh and a sizzle" },
      { weight: 3, shot: "cu", camera: "orbit", action: "{product} turns slowly on the plate, steam rising" },
      { weight: 3, shot: "hero", camera: "static", action: "{product} centred, space above it", say: ["price", "visit"] },
    ] }),
  // ---- Salons
  S({ id: "salon-transformation", name: "Style transformation", business: ["salon"], format: "before-after", seconds: 10, presenter: true, cast: "a fictional young woman in her twenties", place: "a bright modern Kigali salon with a big mirror", light: "soft, flattering salon light", music: "smooth R&B beat",
    beats: [
      { weight: 3, shot: "mcu", camera: "static", action: "the result first: {presenter} turns to the mirror with the finished {name} style, smiling", sound: "salon ambience" },
      { weight: 2, shot: "ms", camera: "handheld", action: "earlier: {presenter} sits down in the chair with plain, tied-back hair" },
      { weight: 2, shot: "cu", camera: "tracking", action: "a stylist's hands work quickly, shaping the style", optional: true },
      { weight: 3, shot: "hero", camera: "orbit", action: "a slow orbit around {presenter} showing the finished style from every side", say: ["book"] },
    ] }),
  S({ id: "salon-process", name: "Behind the chair", business: ["salon"], format: "tour", seconds: 10, place: "a busy Kigali salon", light: "warm salon light", music: "smooth Afro-pop",
    beats: [
      { weight: 2, shot: "macro", camera: "slow-motion", action: "a stylist's hands and combs at work, products lined up", sound: "scissors and soft chatter" },
      { weight: 3, shot: "ms", camera: "gimbal", action: "the camera moves around the chair while the stylist creates {P}" },
      { weight: 2, shot: "cu", camera: "rack-focus", action: "focus moves from the tools to the mirror and the finished look" },
      { weight: 2, shot: "hero", camera: "static", action: "a fictional adult client admires the {name} style in the mirror", say: ["book"] },
    ] }),
  // ---- Phone and electronics shops
  S({ id: "phone-unboxing", name: "Phone unboxing", business: ["phone-shop"], format: "unboxing", seconds: 10, place: "a clean desk in a bright Kigali phone shop", light: "cool, crisp studio light", music: "modern electronic beat",
    beats: [
      { weight: 2, shot: "top", camera: "static", action: "hands slide a sealed box onto the desk", sound: "cardboard on wood" },
      { weight: 2, shot: "pov", camera: "static", action: "thumbs lift the lid and {P} is revealed inside", sound: "the lid sliding off, a soft click" },
      { weight: 3, shot: "cu", camera: "push-in", action: "a hand lifts {product} out and tilts it so the light runs along its edges" },
      { weight: 2, shot: "hero", camera: "orbit", action: "{product} standing on the desk, slow and clean", say: ["usp", "intro"] },
    ] }),
  S({ id: "phone-hero", name: "Phone 3D reveal", business: ["phone-shop"], format: "product-reveal", seconds: 8, place: "a dark studio with a soft blue rim light", light: "dramatic rim light on black", music: "deep cinematic pulse",
    beats: [
      { weight: 2, shot: "macro", camera: "rack-focus", action: "an edge of {P} emerges from darkness, a line of light sweeping across it", sound: "a deep whoosh" },
      { weight: 3, shot: "cu", camera: "orbit", action: "{product} rotates slowly in the air, its screen glowing" },
      { weight: 3, shot: "hero", camera: "pull-out", action: "{product} standing upright, glossy reflections on the floor", say: ["price", "intro"] },
    ] }),
  S({ id: "phone-ugc-review", name: "Honest phone review", business: ["phone-shop"], format: "ugc-testimonial", seconds: 12, presenter: true, cast: FICTIONAL_MAN, place: "a Kigali street outside a phone shop", light: "natural afternoon light", music: "light beat under the voice",
    beats: [
      { weight: 2, shot: "selfie", camera: "handheld", action: "{presenter} holds {P} up to the camera", say: ["found"] },
      { weight: 3, shot: "cu", camera: "handheld", action: "{presenter} takes a photo with {product}, then shows the screen to the camera" },
      { weight: 3, shot: "ms", camera: "tracking", action: "{presenter} walks and talks, {product} in hand", say: ["usp"] },
      { weight: 2, shot: "hero", camera: "static", action: "{product} close to the lens, {presenter} smiling behind", say: ["cta"] },
    ] }),
  S({ id: "phone-offer", name: "Phone deal", business: ["phone-shop"], format: "offer", seconds: 8, place: "a glass counter in a Kigali phone shop", light: "bright, clean shop light", music: "punchy electronic beat",
    beats: [
      { weight: 2, shot: "cu", camera: "whip-pan", action: "along a row of phones on the glass counter, stopping on {P}", sound: "a whoosh" },
      { weight: 3, shot: "cu", camera: "push-in", action: "{product} lights up as a hand picks it up" },
      { weight: 3, shot: "hero", camera: "static", action: "{product} centred on the glass counter, bright and clean", say: ["price", "cta"] },
    ] }),
  // ---- Real estate
  S({ id: "realestate-tour", name: "House tour", business: ["real-estate"], format: "tour", seconds: 15, place: "a modern house on a green Kigali hillside", light: "soft morning light", music: "calm piano with light percussion",
    beats: [
      { weight: 3, shot: "ews", camera: "drone", action: "towards {place}", sound: "birds and a light breeze" },
      { weight: 3, shot: "ws", camera: "gimbal", action: "through the front door into the bright living room" },
      { weight: 3, shot: "ws", camera: "pan", action: "across the kitchen and the big windows" },
      { weight: 2, shot: "ws", camera: "gimbal", action: "into a bedroom, light curtains moving", optional: true },
      { weight: 3, shot: "ws", camera: "pull-out", action: "out onto the balcony as the view opens up", say: ["visit", "intro"] },
    ] }),
  S({ id: "realestate-golden", name: "Golden hour exterior", business: ["real-estate"], format: "product-reveal", seconds: 8, place: "a modern house on a Kigali hillside", light: "warm golden-hour light", music: "warm, hopeful strings",
    beats: [
      { weight: 3, shot: "low", camera: "tilt-up", action: "from the gate up to the whole of {place}" },
      { weight: 2, shot: "ws", camera: "orbit", action: "around the front of the house, windows glowing", optional: true },
      { weight: 3, shot: "hero", camera: "crane-up", action: "rising to show the house and the green hills behind", say: ["intro", "visit"] },
    ] }),
  // ---- Fashion
  S({ id: "fashion-lookbook", name: "Outfit lookbook", business: ["fashion"], format: "product-reveal", seconds: 10, presenter: true, cast: "a fictional model in her twenties", place: "a colourful Kigali street wall", light: "bright afternoon sun", music: "stylish Afro-house",
    beats: [
      { weight: 2, shot: "low", camera: "tilt-up", action: "from the shoes up to {presenter} wearing {P}", sound: "street ambience" },
      { weight: 3, shot: "ms", camera: "tracking", action: "{presenter} walks towards the camera in {product}, the fabric moving" },
      { weight: 2, shot: "macro", camera: "slow-motion", action: "the fabric and pattern of {product} moving in the breeze", optional: true },
      { weight: 2, shot: "hero", camera: "static", action: "{presenter} stops, poses and smiles, {product} clearly visible", say: ["price", "intro"] },
    ] }),
  S({ id: "fashion-outfit-switch", name: "Outfit switch", business: ["fashion"], format: "before-after", seconds: 8, presenter: true, cast: "a fictional young woman in her twenties", place: "a bright bedroom with a tall mirror", light: "soft window light", music: "beat drop on the switch",
    beats: [
      { weight: 2, shot: "ms", camera: "static", action: "the result first: {presenter} in {P}, a confident pose, then turns to the mirror" },
      { weight: 2, shot: "ms", camera: "static", action: "earlier: {presenter} in plain everyday clothes faces the mirror and shrugs" },
      { weight: 1, shot: "ms", camera: "whip-pan", action: "{presenter} spins", sound: "a whoosh and a beat drop", optional: true },
      { weight: 2, shot: "hero", camera: "push-in", action: "on {product} after the switch, its colours and pattern exactly as in the photo", say: ["usp", "intro"] },
    ] }),
  S({ id: "fashion-try-on", name: "Try-on haul", business: ["fashion"], format: "ugc-testimonial", seconds: 12, presenter: true, cast: FICTIONAL_WOMAN, place: "a fitting room with a big mirror", light: "warm, even light", music: "light pop beat",
    beats: [
      { weight: 2, shot: "selfie", camera: "handheld", action: "{presenter} holds up a shopping bag to the camera, excited", say: ["found"] },
      { weight: 3, shot: "ms", camera: "static", action: "{presenter} steps back from the mirror wearing {P} and turns to show the back" },
      { weight: 2, shot: "cu", camera: "handheld", action: "{presenter} shows the fabric and the fit of {product} up close", optional: true },
      { weight: 2, shot: "hero", camera: "static", action: "{presenter} poses in {product}, smiling", say: ["cta"] },
    ] }),
  // ---- Events
  S({ id: "events-hype", name: "Event hype", business: ["events"], format: "offer", seconds: 10, place: "an event venue in Kigali", light: "colourful stage lights and light haze", music: "high-energy Afrobeats",
    beats: [
      { weight: 3, shot: "ews", camera: "crane-up", action: "over {place} as the stage lights come on", sound: "a crowd cheering" },
      { weight: 3, shot: "ms", camera: "tracking", action: "fictional adult dancers seen from behind, moving to the music" },
      { weight: 2, shot: "cu", camera: "slow-motion", action: "confetti falls through the light", optional: true },
      { weight: 2, shot: "hero", camera: "pull-out", action: "a wide view of the lit stage, space above it", say: ["intro", "visit"] },
    ] }),
  S({ id: "events-venue-tour", name: "Venue tour", business: ["events"], format: "tour", seconds: 12, place: "a decorated garden venue in Kigali at dusk", light: "warm string lights at dusk", music: "elegant acoustic",
    beats: [
      { weight: 3, shot: "ews", camera: "drone", action: "slowly over {place}, string lights glowing", sound: "soft evening ambience" },
      { weight: 3, shot: "ws", camera: "gimbal", action: "between dressed tables, flowers and candles" },
      { weight: 2, shot: "cu", camera: "rack-focus", action: "from a candle to the stage behind", optional: true },
      { weight: 2, shot: "hero", camera: "crane-up", action: "rising over the whole venue", say: ["book", "visit"] },
    ] }),
  // ---- Services
  S({ id: "services-before-after", name: "Clean before and after", business: ["services"], format: "before-after", seconds: 10, place: "a home in Kigali", light: "bright daylight", music: "upbeat, satisfying beat",
    beats: [
      { weight: 3, shot: "ws", camera: "static", action: "the result first: a spotless, shining room in {place}", sound: "a bright chime" },
      { weight: 2, shot: "ws", camera: "static", action: "the same spot before: dusty and untidy" },
      { weight: 3, shot: "ms", camera: "tracking", action: "a fictional adult worker in a uniform, seen from behind, works quickly with {product}" },
      { weight: 2, shot: "hero", camera: "push-in", action: "on the clean, shining result", say: ["book"] },
    ] }),
  S({ id: "services-at-work", name: "At work", business: ["services"], format: "tour", seconds: 10, place: "a tidy Kigali workshop", light: "practical workshop light", music: "steady, confident beat",
    beats: [
      { weight: 2, shot: "macro", camera: "slow-motion", action: "skilled hands and tools at work on {P}", sound: "tools clicking" },
      { weight: 3, shot: "ms", camera: "gimbal", action: "around the workbench while the job gets done" },
      { weight: 2, shot: "cu", camera: "rack-focus", action: "from the tools to the finished work", optional: true },
      { weight: 2, shot: "hero", camera: "static", action: "the finished job, clean and ready", say: ["book", "visit"] },
    ] }),
  S({ id: "services-ugc", name: "Happy client", business: ["services"], format: "ugc-testimonial", seconds: 10, presenter: true, cast: FICTIONAL_WOMAN, place: "a bright Kigali home", light: "natural window light", music: "warm, light beat",
    beats: [
      { weight: 3, shot: "selfie", camera: "handheld", action: "{presenter} shows the finished {name} result to the camera, delighted", say: ["found"] },
      { weight: 3, shot: "ms", camera: "handheld", action: "{presenter} walks around and points at the details" },
      { weight: 2, shot: "hero", camera: "static", action: "{presenter} gives a thumbs up", say: ["book"] },
    ] }),
  // ---- Education
  S({ id: "education-ugc", name: "Student story", business: ["education"], format: "ugc-testimonial", seconds: 12, presenter: true, cast: "a fictional student in her early twenties", place: "a bright Kigali classroom", light: "soft daylight", music: "hopeful, light beat",
    beats: [
      { weight: 3, shot: "selfie", camera: "handheld", action: "{presenter} walks to class, talking to the camera", say: ["learn"] },
      { weight: 3, shot: "ws", camera: "gimbal", action: "through {place}, a fictional adult teacher explaining to the class" },
      { weight: 2, shot: "cu", camera: "static", action: "{presenter} works on a laptop, focused", optional: true },
      { weight: 2, shot: "hero", camera: "static", action: "{presenter} smiles at the camera, classmates behind", say: ["usp", "cta"] },
    ] }),
  S({ id: "education-tour", name: "Campus tour", business: ["education"], format: "tour", seconds: 10, place: "a modern training centre in Kigali", light: "bright morning light", music: "inspiring piano",
    beats: [
      { weight: 3, shot: "ews", camera: "drone", action: "towards {place}", sound: "morning birds" },
      { weight: 3, shot: "ws", camera: "gimbal", action: "through a busy classroom of fictional adult students" },
      { weight: 2, shot: "cu", camera: "rack-focus", action: "from a notebook to a student's smile", optional: true },
      { weight: 2, shot: "hero", camera: "pull-out", action: "out of the building entrance in the sun", say: ["visit", "intro"] },
    ] }),
  // ---- Any business (fallbacks)
  S({ id: "any-product-hero", name: "Studio product hero", business: ["any"], format: "product-reveal", seconds: 6, place: "a clean studio set with a soft gradient backdrop", light: "soft studio light with a rim highlight", music: "modern, confident beat",
    beats: [
      { weight: 2, shot: "macro", camera: "rack-focus", action: "a detail of {P}, a line of light sweeping across it", sound: "a soft whoosh" },
      { weight: 2, shot: "cu", camera: "orbit", action: "{product} turning slowly, every side clear" },
      { weight: 2, shot: "hero", camera: "pull-out", action: "{product} centred and still, space above it", say: ["price", "intro"] },
    ] }),
  S({ id: "any-unboxing", name: "Unboxing", business: ["any"], format: "unboxing", seconds: 10, place: "a wooden table at home in Kigali", light: "soft window light", music: "light ASMR-style ambience",
    beats: [
      { weight: 2, shot: "top", camera: "static", action: "hands place a parcel on the table", sound: "paper rustling" },
      { weight: 3, shot: "pov", camera: "static", action: "the parcel opens and {P} is revealed", sound: "tape ripping, a soft gasp" },
      { weight: 3, shot: "cu", camera: "push-in", action: "a hand lifts {product} and turns it in the light" },
      { weight: 2, shot: "hero", camera: "static", action: "{product} on the table, clean and centred", say: ["usp", "cta"] },
    ] }),
  S({ id: "any-ugc-review", name: "Customer review", business: ["any"], format: "ugc-testimonial", seconds: 10, presenter: true, cast: FICTIONAL_WOMAN, place: "a bright Kigali living room", light: "natural window light", music: "light beat under the voice",
    beats: [
      { weight: 3, shot: "selfie", camera: "handheld", action: "{presenter} holds {P} up to the camera, excited", say: ["found"] },
      { weight: 3, shot: "cu", camera: "handheld", action: "{presenter} uses {product} and shows the result" },
      { weight: 2, shot: "hero", camera: "static", action: "{product} close to the lens, {presenter} nodding behind", say: ["usp", "cta"] },
    ] }),
  S({ id: "any-offer", name: "Quick offer", business: ["any"], format: "offer", seconds: 6, place: "a bold, colourful set", light: "bright, punchy light", music: "energetic drum hit",
    beats: [
      { weight: 2, shot: "cu", camera: "whip-pan", action: "a whip onto {P}", sound: "a whoosh and a drum hit" },
      { weight: 2, shot: "cu", camera: "push-in", action: "{product} pops forward under a spotlight" },
      { weight: 2, shot: "hero", camera: "static", action: "{product} centred, space above it", say: ["price", "cta"] },
    ] }),
  S({ id: "any-before-after", name: "Problem then fix", business: ["any"], format: "before-after", seconds: 10, place: "an everyday Kigali home", light: "natural daylight", music: "satisfying beat drop",
    beats: [
      { weight: 3, shot: "ms", camera: "static", action: "the happy result first, thanks to {P}", sound: "a bright chime" },
      { weight: 2, shot: "ms", camera: "handheld", action: "earlier: the everyday problem, a fictional adult sighing" },
      { weight: 3, shot: "cu", camera: "push-in", action: "{product} in use, fixing it", sound: "a satisfying click" },
      { weight: 2, shot: "hero", camera: "static", action: "{product} centred and clean", say: ["usp", "cta"] },
    ] }),
  S({ id: "any-tour", name: "Inside the business", business: ["any"], format: "tour", seconds: 12, place: "the inside of a welcoming Kigali business", light: "warm, natural light", music: "warm Afro-pop",
    beats: [
      { weight: 3, shot: "ws", camera: "gimbal", action: "in through the door of {place}", sound: "a door bell and friendly chatter" },
      { weight: 3, shot: "ws", camera: "pan", action: "across the space, staff (fictional adults) at work" },
      { weight: 2, shot: "cu", camera: "push-in", action: "on {P}", optional: true },
      { weight: 2, shot: "hero", camera: "pull-out", action: "the whole place, welcoming and bright", say: ["visit"] },
    ] }),
];

export const seedanceTemplateById = (id: string | null | undefined): SeedanceTemplate | null => SEEDANCE_TEMPLATES.find((t) => t.id === id) ?? null;

/** The Seedance format closest to a Claude engine template (lib/video-engine/templates.ts). */
export function formatForClaudeTemplate(id: string | null | undefined): SeedanceFormat | null {
  if (!id) return null;
  if (id === "ugc-unboxing") return "unboxing";
  if (id === "ugc-before-after") return "before-after";
  if (/^ugc-|^tiktok-/.test(id)) return "ugc-testimonial";
  if (/offer|price-drop|event-poster/.test(id)) return "offer";
  if (/brand-story|kigali-market|story-cinematic/.test(id)) return "tour";
  return /^(product-hero|studio-turntable|macro-detail|ice-splash|kinetic-type|hypermotion|dark-minimal|colour-pop|typography-poster|tv-spot|golden-hour|marketplace-listing|colour-options)$/.test(id) ? "product-reveal" : null;
}

const KIND_PATTERNS: [BusinessKind, RegExp][] = [
  ["phone-shop", /\b(phones?|smartphones?|samsung|iphone|tecno|infinix|itel|galaxy|laptops?|electronics?|chargers?|earbuds|tablets?)\b/i],
  ["real-estate", /\b(house|houses|apartments?|plots?|land|rent(al)?|real estate|property|villa|bedrooms?)\b/i],
  ["restaurant", /\b(restaurant|caf[eé]|food|menu|dish(es)?|brochettes?|coffee|bakery|pizza|burgers?|juice|catering|lunch|dinner|buffet)\b/i],
  ["salon", /\b(salon|hair|braids?|barber(shop)?|nails?|beauty|make-?up|spa|wigs?)\b/i],
  ["fashion", /\b(fashion|dress(es)?|clothes|clothing|kitenge|shoes|boutique|shirts?|bags?|outfits?|wear)\b/i],
  ["events", /\b(events?|concert|wedding|party|festival|conference|tickets?|venue)\b/i],
  ["education", /\b(school|courses?|training|class(es)?|academy|lessons?|tutoring|university|bootcamp)\b/i],
  ["services", /\b(cleaning|repairs?|plumb(ing|er)|garage|car wash|printing|laundry|mechanic|tailor(ing)?|moving|installation)\b/i],
  ["shop", /\b(hydroponic|farming|seeds?|tools?|equipment|appliances?|furniture|soap|cosmetics|groceries)\b/i],
];

export type SeedanceBrief = {
  business: { name: string; description?: string | null; language?: string | null; country?: string | null };
  product: { name: string; summary?: string | null; description?: string | null; price?: string | null; usps?: string[]; features?: string[] };
  /** What each reference is, in order: "Image 1: the product photo (blue phone on a stand)". */
  references?: string[];
  /** A Seedance template id, or a Claude engine template id (its format is used). */
  templateId?: string | null;
  seconds?: number;
  ratio?: string;
  audio?: boolean;
  fixedLens?: boolean;
  presenter?: string | null;
  businessKind?: BusinessKind | null;
  format?: SeedanceFormat | null;
  /** Picks another template of the same kind and format (for versions). */
  variant?: number;
  /** A viral recipe (brain/viral.ts): the plan takes its number of shots, their timing and its camera. */
  shotRecipe?: SeedanceRecipe | null;
};

/** The parts of a viral recipe the shot plan follows. */
export type SeedanceRecipe = { beats: { from: number; to: number }[]; camera: { moves: readonly string[] } };
/** The video engine's camera moves (spec.ts) in Seedance's camera language (CAMERA_LANGUAGE ids). */
const RECIPE_CAMERA: Record<string, string> = { static: "static", dollyIn: "push-in", dollyOut: "pull-out", panLeft: "pan", panRight: "pan", tiltUp: "tilt-up", tiltDown: "tilt-up", orbitLeft: "orbit", orbitRight: "orbit", craneUp: "crane-up", craneDown: "crane-up", crashZoom: "push-in", pushPull: "dolly-zoom", dutchRoll: "handheld", handheld: "handheld" };

/**
 * The business kind, read from the product's name first, then its summary, then the business (a real-estate agency
 * that sells a cleaning service is a service here); "shop" when nothing matches.
 */
export function detectBusinessKind(b: Pick<SeedanceBrief, "business" | "product">): BusinessKind {
  for (const text of [b.product.name, b.product.summary, `${b.business.name} ${b.business.description ?? ""}`]) {
    const hit = text && KIND_PATTERNS.find(([, re]) => re.test(text));
    if (hit) return hit[0];
  }
  return "shop";
}

/** Picks the template for a brief: the one asked for, else one for the business kind and format, else a fallback. */
export function pickSeedanceTemplate(b: SeedanceBrief): SeedanceTemplate {
  const asked = seedanceTemplateById(b.templateId);
  if (asked) return asked;
  const kind = b.businessKind ?? detectBusinessKind(b);
  const format = b.format ?? formatForClaudeTemplate(b.templateId) ?? (b.presenter ? "ugc-testimonial" : "product-reveal");
  const pools = [
    SEEDANCE_TEMPLATES.filter((t) => t.format === format && t.business.includes(kind)),
    SEEDANCE_TEMPLATES.filter((t) => t.format === format && t.business.includes("any")),
    SEEDANCE_TEMPLATES.filter((t) => t.business.includes(kind)),
  ];
  const pool = pools.find((p) => p.length) ?? [SEEDANCE_TEMPLATES.find((t) => t.id === "any-product-hero") as SeedanceTemplate];
  return pool[Math.abs(b.variant ?? 0) % pool.length];
}

// ---- (c) Rules Claude's prompt writer follows (and the planner below obeys)

export const SEEDANCE_RULES: { id: string; rule: string }[] = [
  { id: "time", rule: "Structure by time: '0-2s: ...; 2-5s: ...' covering exactly the requested length. One shot every 2 to 4 seconds: 2 to 4 shots, never more than 5 in 15 s. Each shot: shot type, camera move, action, and (with sound) the sound." },
  { id: "subject", rule: "One product, one place, at most one presenter. Name the subject, the action with concrete verbs (lifts, turns, pours, opens), the place, the light and the mood. Speed words help: slowly, gently, quickly." },
  { id: "camera", rule: "One camera move per shot, in words Seedance knows (see the camera list). With a fixed lens, no camera moves at all: say 'static camera'." },
  { id: "hook", rule: "The first 1 to 2 seconds stop the scroll: motion or a reveal in the very first frame. Show the product working or the result before any persuasion. In before/after, show the result first." },
  { id: "fidelity", rule: "The product stays exactly as in its photo: 'the <product> from Image N, exactly as in the photo: same shape, colours, logo and label'. Never change, add or remove a logo, label, colour or part, and never show a different model." },
  { id: "references", rule: "Refer to references exactly as numbered (Image 1, Video 1, Audio 1) and only to ones that exist. Say what each one is for: the product, the place, the presenter, the motion to copy, the music." },
  { id: "facts", rule: "Use ONLY facts in the brief. No invented prices, discounts, stock counts, awards, ingredients, guarantees, delivery promises or results. No price in the brief: no price spoken." },
  { id: "people", rule: "No real or famous people and no lookalikes. People are fictional adults described generally (age range, clothing, mood) or a presenter the brief names from the digital character library. Never a child as the subject. Respectful everyday clothing. Nothing medical, no body or skin before/after." },
  { id: "text", rule: "Clean frames: no on-screen text, captions, subtitles, signs with words or logos added (Seedance garbles letters; BuPulse adds the text later). End on a clean hero shot of the product with space above it for the caption." },
  { id: "sound", rule: "With sound: one ambient sound, one music mood, and at most one or two short spoken lines (under 12 words each) in double quotes, saying who speaks and in which language. Without sound: no sound or spoken words at all." },
  { id: "language", rule: "Spoken lines in the business's content language. English and French are reliable. For Kinyarwanda or Swahili, write no spoken line: music and ambient sound only (the voice-over is added afterwards with ElevenLabs)." },
  { id: "place", rule: "Real Rwandan and East African settings where it fits: a Kigali shop counter, a market stall, a salon chair, a home kitchen, a boda-boda street, green hills. Warm, honest, everyday." },
  { id: "length", rule: "60 to 160 words of plain sentences. Describe what should be seen, not lists of what to avoid. No contradictions (a static camera that also orbits)." },
];

/** The prompt length Seedance follows best (the "length" rule): 60 to 160 words. */
export const MIN_PROMPT_WORDS = 60;
export const MAX_PROMPT_WORDS = 160;

/**
 * Cuts a prompt to at most `max` words, at the last sentence end inside the limit when that keeps most of it, so
 * Seedance never gets a half sentence. Line breaks are kept.
 */
export function limitPromptWords(text: string, max = MAX_PROMPT_WORDS + 10): string {
  const tokens = text.trim().match(/\S+\s*/g) ?? [];
  if (tokens.length <= max) return text.trim();
  const kept = tokens.slice(0, max).join("");
  const ends = [...kept.matchAll(/[.!?]["”]?(?=\s|$)/g)];
  const last = ends.at(-1);
  const cut = last && last.index !== undefined && last.index + last[0].length > kept.length * 0.6 ? kept.slice(0, last.index + last[0].length) : kept;
  return cut.trim();
}

export const seedanceRulesText = () => SEEDANCE_RULES.map((r) => `- ${r.rule}`).join("\n");
export const cameraLanguageText = () => CAMERA_LANGUAGE.map((c) => `${c.words} (${c.feel})`).join("; ");
export const shotTypesText = () => SHOT_TYPES.map((s) => `${s.words} (${s.use})`).join("; ");

// ---- (d) The planner: a template filled from the brief, no AI

export type PlannedShot = { from: number; to: number; shot: string; camera: string; action: string; sound: string | null; spoken: string | null; references: string[] };
export type SeedancePlan = {
  templateId: string;
  templateName: string;
  businessKind: BusinessKind;
  format: SeedanceFormat;
  language: "en" | "fr" | "rw" | "sw";
  seconds: number;
  ratio: string;
  shots: PlannedShot[];
  prompt: string;
  words: number;
  /** Plain-English notes for the owner (missing photo, no spoken line, fictional presenter...). */
  notes: string[];
};

const LANG_NAMES = { en: "English", fr: "French", rw: "Kinyarwanda", sw: "Swahili" } as const;
export function languageOf(language: string | null | undefined): SeedancePlan["language"] {
  const l = (language ?? "").trim().toLowerCase();
  if (/^(fr|fran)/.test(l)) return "fr";
  if (/^(rw|kin)/.test(l)) return "rw";
  if (/^(sw|swa|kis)/.test(l)) return "sw";
  return "en";
}

type ParsedRef = { kind: "Image" | "Video" | "Audio"; n: number; label: string };
const parseRefs = (refs: string[] = []): ParsedRef[] =>
  refs.flatMap((r) => {
    const m = r.match(/^\s*(Image|Video|Audio)\s+(\d+)\s*:?\s*(.*)$/i);
    if (!m) return [];
    const kind = (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as ParsedRef["kind"];
    return [{ kind, n: Number(m[2]), label: m[3] ?? "" }];
  });
const PERSON_REF = /presenter|character|influencer|avatar|asset:|\bperson\b|\bmodel\b|\bwoman\b|\bman\b|portrait|selfie|face/i;
const PLACE_REF = /\b(shop|store|room|interior|exterior|house|building|restaurant|salon|venue|street|office|place|kitchen|garden|view|classroom|workshop)\b/i;
const RATIO_WORDS: Record<string, string> = { "9:16": "vertical 9:16", "3:4": "portrait 3:4", "1:1": "square 1:1", "4:3": "4:3", "16:9": "wide 16:9", "21:9": "cinematic 21:9", adaptive: "" };

/** Whole-second boundaries for the beats, each at least 1 s, adding up to `seconds`. */
function timeline(weights: number[], seconds: number): [number, number][] {
  const total = weights.reduce((a, w) => a + w, 0);
  const out: [number, number][] = [];
  let acc = 0;
  let from = 0;
  weights.forEach((w, i) => {
    acc += w;
    const left = weights.length - 1 - i;
    const to = i === weights.length - 1 ? seconds : Math.min(seconds - left, Math.max(from + 1, Math.round((seconds * acc) / total)));
    out.push([from, to]);
    from = to;
  });
  return out;
}

/** Builds the Seedance prompt from a template and the brief's facts. Instant and free. */
export function planSeedanceShots(brief: SeedanceBrief): SeedancePlan {
  const t = pickSeedanceTemplate(brief);
  const kind = brief.businessKind ?? detectBusinessKind(brief);
  const seconds = Math.min(SEEDANCE_LIMITS.maxSeconds, Math.max(SEEDANCE_LIMITS.minSeconds, Math.round(brief.seconds ?? t.seconds)));
  const ratio = brief.ratio && (SEEDANCE_RATIOS as readonly string[]).includes(brief.ratio) ? brief.ratio : "9:16";
  const audio = brief.audio !== false;
  const lang = languageOf(brief.business.language);
  const notes: string[] = [];

  // References: which image is the product, the place and the presenter.
  const refs = parseRefs(brief.references);
  const images = refs.filter((r) => r.kind === "Image");
  const personImg = images.find((r) => PERSON_REF.test(r.label));
  const placeImg = images.find((r) => r !== personImg && PLACE_REF.test(r.label));
  let productImg = images.find((r) => r !== personImg && r !== placeImg);
  const placeFirst = kind === "real-estate" || kind === "events";
  const placeRef = placeImg ?? (placeFirst ? productImg : undefined);
  // For a house or a venue every photo shows the place: none is a "product" with a logo and a label.
  if (placeFirst) productImg = undefined;
  const morePlace = placeFirst ? images.filter((r) => r !== personImg && r !== placeRef) : [];
  const product = brief.product.name.trim();
  // In the shots, a long name is shortened to the part before " – " or a comma; the full name stays in the fidelity line.
  const shortName = product.split(/\s+[–—-]\s+|,\s*/)[0].trim() || product;
  const place = placeRef ? `the place in Image ${placeRef.n}` : t.place;
  const presenterText = personImg ? `the presenter from Image ${personImg.n}` : brief.presenter?.trim() || t.cast || "a friendly fictional adult";
  if (!images.length && !placeFirst) notes.push(`No product photo: Seedance will imagine the ${product} from the words. Add a photo as Image 1 so it looks exactly like yours.`);
  if (t.presenter && !personImg && !brief.presenter) notes.push("The presenter is a fictional person described in words, so the face changes between clips. Pick a digital character from the library for the same face every time.");
  if (personImg && !/asset:|digital character/i.test(personImg.label)) notes.push(`Image ${personImg.n} shows a person: BytePlus refuses photos with real-looking faces. Use a digital character from the library (asset://...) instead.`);

  // Beats: drop optional ones first, then from the middle, so each shot has about 2 s or more.
  // About one shot per 2.5 to 3 s (the TikTok research: a cut every 2-3 s).
  // The opening shot, the end shot and (in a before/after) the "before" are never dropped: optional shots go first,
  // then middle ones.
  const keep = t.format === "before-after" ? 2 : 1;
  const maxShots = Math.max(keep + 1, Math.min(5, Math.floor(seconds / 2.5)));
  const dropBeat = (list: SeedanceBeat[]) => {
    const i = list.findIndex((b, j) => j >= keep && j < list.length - 1 && b.optional);
    list.splice(i >= 0 ? i : Math.max(keep, Math.floor(list.length / 2)), 1);
  };
  const beats = [...t.beats];
  while (beats.length > maxShots) dropBeat(beats);
  // A viral recipe: as many shots as its beats (within the clip's limit), timed like them, with its camera moves.
  const recipe = brief.shotRecipe;
  if (recipe?.beats.length) {
    while (beats.length > Math.max(keep + 1, Math.min(maxShots, recipe.beats.length))) dropBeat(beats);
    const lengths = recipe.beats.map((b) => Math.max(0.5, b.to - b.from));
    const moves = recipe.camera.moves.map((m) => RECIPE_CAMERA[m]).filter((m): m is string => !!m);
    const pick = (i: number) => lengths[Math.round((i * (lengths.length - 1)) / Math.max(1, beats.length - 1))];
    beats.splice(0, beats.length, ...beats.map((b, i) => ({ ...b, weight: pick(i) ?? b.weight, camera: moves.length ? moves[i % moves.length] : b.camera })));
    notes.push("The shots follow the viral recipe: its number of shots, their timing and its camera.");
  }

  // Spoken lines: only facts, only languages Seedance speaks well.
  // Spoken facts stay short: the first selling point under 12 words, a price without conditions, the name before " – ".
  const usp = brief.product.usps?.map((u) => u.trim().replace(/[.,;:!]+$/, "")).find((u) => u && u.split(/\s+/).length <= 12) ?? null;
  const rawPrice = brief.product.price?.trim() || null;
  const price = rawPrice && !/[(]/.test(rawPrice) && rawPrice.length <= 40 ? rawPrice : null;
  if (audio && rawPrice && !price) notes.push("The price has conditions, so it is not spoken; show it in the caption instead.");
  const speaks = audio && (lang === "en" || lang === "fr");
  if (audio && !speaks) notes.push(`No spoken line: Seedance does not speak ${LANG_NAMES[lang]} reliably. Music and sound only; add the ${LANG_NAMES[lang]} voice-over afterwards with ElevenLabs.`);
  if (audio && !rawPrice && beats.some((b) => b.say?.includes("price"))) notes.push("No price in the product details, so no price is spoken.");
  const presents = !!(t.presenter || personImg || brief.presenter);

  const ratioWords = RATIO_WORDS[ratio] ?? "";
  const formatWords = SEEDANCE_FORMATS.find((f) => f.id === t.format)?.words ?? "ad";
  const kindWords = BUSINESS_KINDS.find((k) => k.id === kind)?.words ?? "a local business";
  const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

  /**
   * Writes the prompt from a set of beats. `lines` is the number of spoken lines (the opening hook and the end when
   * 2); `sounds` false keeps a sound on the first shot only. Names, references and camera moves are said in full
   * once, then shortly.
   */
  const compose = (list: SeedanceBeat[], o: { lines: number; sounds: boolean; compact: boolean }) => {
    let productMentioned = false;
    const P = () => {
      if (!productImg || productMentioned) return `the ${shortName}`;
      productMentioned = true;
      return `the ${shortName} from Image ${productImg.n}`;
    };
    let presenterMentioned = false;
    const presenter = () => {
      if (presenterMentioned) return "the presenter";
      presenterMentioned = true;
      return presenterText;
    };
    const used = new Set<SayKey>();
    const line = (keys: SayKey[] | undefined): string | null => {
      if (!speaks || !keys) return null;
      for (const k of keys) {
        const l = LINES[k];
        if (used.has(k) || (l.needs === "price" && !price) || (l.needs === "usp" && !usp)) continue;
        used.add(k);
        const said = l[lang as "en" | "fr"].replace("{product}", shortName).replace("{business}", brief.business.name.trim()).replace("{price}", price ?? "").replace("{usp}", usp ?? "");
        return `${said[0].toUpperCase()}${said.slice(1)}`;
      }
      return null;
    };
    const sayAt = list.flatMap((b, i) => (b.say?.length ? [i] : []));
    const keepSay = new Set(o.lines >= 2 && sayAt.length >= 2 ? [sayAt[0], sayAt[sayAt.length - 1]] : sayAt.slice(-1));
    const times = timeline(list.map((b) => b.weight), seconds);
    const shots: PlannedShot[] = list.map((b, i) => {
      const camera = brief.fixedLens ? cameraById("static") : cameraById(b.camera);
      const action = b.action.replace(/\{P\}/g, P).replace(/\{product\}/g, `the ${shortName}`).replace(/\{name\}/g, shortName).replace(/\{presenter\}/g, presenter).replace(/\{place\}/g, place);
      const spoken = keepSay.has(i) ? line(b.say) : null;
      const references = [...new Set((action.match(/(Image|Video|Audio) \d+/g) ?? []) as string[])];
      return { from: times[i][0], to: times[i][1], shot: shotById(b.shot).words, camera: camera.words, action, sound: audio && b.sound && (o.sounds || i === 0) ? b.sound : null, spoken, references };
    });
    // A short clip may have dropped every shot that names the product: the end shot carries its photo then.
    if (productImg && !productMentioned) {
      const end = shots[shots.length - 1];
      end.action = `${end.action}, with ${P()} in view`;
      end.references = [...new Set([...end.references, `Image ${productImg.n}`])];
    }
    const cameraSaid = new Set<string>();
    const shotSaid = new Set<string>();
    let spokenSaid = false;
    const lines = [
      `A ${ratioWords ? `${ratioWords} ` : ""}${formatWords} for ${kindWords} in ${brief.business.country?.trim() || "Rwanda"}. Setting: ${placeRef ? `${place}, exactly as in the photo${morePlace.length ? ` (${morePlace.map((r) => `Image ${r.n}`).join(" and ")} show${morePlace.length > 1 ? "" : "s"} more of it)` : ""}` : place}. Light: ${t.light}.${audio ? ` Music: ${t.music}.` : ""}`,
      productImg ? `The ${product} must look exactly as in Image ${productImg.n}: same shape, colours, logo and label.` : "",
      ...shots.map((s, i) => {
        const move = brief.fixedLens ? cameraById("static") : cameraById(list[i].camera);
        const cam = o.compact || cameraSaid.has(move.id) ? move.short : move.words;
        cameraSaid.add(move.id);
        const type = shotById(list[i].shot);
        const shotWords = o.compact || shotSaid.has(type.id) ? type.short : type.words;
        shotSaid.add(type.id);
        let said = "";
        if (s.spoken) {
          said = spokenSaid ? ` ${presents ? "The presenter" : "The voice-over"} says: "${s.spoken}"` : ` ${presents ? "The presenter says to the camera" : "A warm voice-over says"} in ${LANG_NAMES[lang]}: "${s.spoken}"`;
          spokenSaid = true;
        }
        return `${s.from}-${s.to}s: ${shotWords[0].toUpperCase()}${shotWords.slice(1)}, ${cam}: ${s.action}.${s.sound ? ` Sound: ${s.sound}.` : ""}${said}`;
      }),
    ];
    for (const r of refs) {
      if (r.kind === "Video") lines.push(`Follow the camera motion and pacing of Video ${r.n}.`);
      if (r.kind === "Audio" && audio) lines.push(`Use Audio ${r.n} as the soundtrack.`);
    }
    lines.push("No on-screen text or added logos.");
    return { shots, prompt: lines.filter(Boolean).join("\n") };
  };

  // The 160-word rule: fewer sounds, then one spoken line, then short shot and camera words, then fewer shots until
  // it fits.
  const opts = { lines: seconds >= 12 ? 2 : 1, sounds: true, compact: false };
  let out = compose(beats, opts);
  for (const squeeze of [() => (opts.sounds = false), () => (opts.lines = 1), () => (opts.compact = true)]) {
    if (wordCount(out.prompt) <= MAX_PROMPT_WORDS) break;
    squeeze();
    out = compose(beats, opts);
  }
  while (wordCount(out.prompt) > MAX_PROMPT_WORDS && beats.length > keep + 1) {
    dropBeat(beats);
    out = compose(beats, opts);
  }
  const { shots, prompt } = out;
  return { templateId: t.id, templateName: t.name, businessKind: kind, format: t.format, language: lang, seconds, ratio, shots, prompt, words: wordCount(prompt), notes };
}

// ---- (e) Checks before we pay: what BytePlus will refuse, and what will disappoint

export type SeedanceIssue = { level: "error" | "warning" | "info"; code: string; message: string };

const TIMECODE = /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\b/gi;

/** Reads the time codes of a prompt ("0-2s: ..."): [from, to] pairs in order. */
export const promptTimecodes = (prompt: string): [number, number][] => [...prompt.matchAll(TIMECODE)].map((m) => [Number(m[1]), Number(m[2])]);

/** Checks a prompt alone (Claude's or the owner's) against the rules. */
export function lintSeedancePrompt(prompt: string, ctx: { seconds: number; images: number; videos: number; audios: number; fixedLens?: boolean; audio?: boolean }): SeedanceIssue[] {
  const issues: SeedanceIssue[] = [];
  const text = prompt.trim();
  if (!text) return [{ level: "error", code: "prompt-empty", message: "The prompt is empty. Write what Seedance should film, or press Write with Claude." }];
  if (text.length > 4000) issues.push({ level: "warning", code: "prompt-long", message: `The prompt is ${text.length} characters; only the first 4,000 are sent. Keep it to 60 to 160 words.` });
  const words = text.split(/\s+/).length;
  if (words < 15) issues.push({ level: "warning", code: "prompt-short", message: "The prompt is very short. Say what is shown, the camera move, the place, the light and the sound." });
  else if (words > MAX_PROMPT_WORDS) issues.push({ level: "warning", code: "prompt-wordy", message: `The prompt has ${words} words. Seedance follows ${MIN_PROMPT_WORDS} to ${MAX_PROMPT_WORDS} words best; long prompts lose details.` });
  for (const [kind, count] of [["Image", ctx.images], ["Video", ctx.videos], ["Audio", ctx.audios]] as const) {
    const named = [...new Set([...text.matchAll(new RegExp(`\\b${kind}\\s*(\\d+)`, "gi"))].map((m) => Number(m[1])))];
    const missing = named.filter((n) => n < 1 || n > count);
    if (missing.length) issues.push({ level: "error", code: "reference-missing", message: `The prompt talks about ${missing.map((n) => `${kind} ${n}`).join(", ")}, but ${count === 0 ? `no ${kind.toLowerCase()} is attached` : `only ${count} ${kind.toLowerCase()}${count > 1 ? "s are" : " is"} attached`}.` });
  }
  if (ctx.images + ctx.videos + ctx.audios > 0 && !/\b(Image|Video|Audio)\s*\d+/i.test(text)) issues.push({ level: "warning", code: "reference-unused", message: "References are attached but the prompt never names them. Say 'the product from Image 1' so Seedance copies it exactly." });
  const codes = promptTimecodes(text);
  if (!codes.length) issues.push({ level: "info", code: "no-timecodes", message: "No time structure. Prompts like '0-2s: ...; 2-5s: ...' give you control over each shot." });
  else {
    const end = Math.max(...codes.map((c) => c[1]));
    if (Math.abs(end - ctx.seconds) > 1) issues.push({ level: "warning", code: "timecodes-length", message: `The shots end at ${end} s but the clip is ${ctx.seconds} s long. Make the time codes add up to the length.` });
    if (codes.length > 5 && ctx.seconds <= 15) issues.push({ level: "warning", code: "too-many-shots", message: `${codes.length} shots in ${ctx.seconds} s is too fast; Seedance handles 2 to 5 shots well.` });
  }
  // Sentences that refuse text ("no on-screen text, captions or logos") are not asking for it.
  const textAsked = /(on-?screen text|captions?|subtitles?|title card|text (that )?(says|reads)|words? ["“])/i;
  const asking = text.split(/[.\n]/).filter((s) => !/\b(no|without|never)\b/i.test(s));
  if (asking.some((s) => textAsked.test(s))) issues.push({ level: "warning", code: "on-screen-text", message: "The prompt asks for text in the video. Seedance garbles letters; BuPulse adds captions afterwards." });
  if (ctx.fixedLens) {
    const moves = CAMERA_PATTERNS.filter(([re, id]) => id !== "static" && id !== "slow-motion" && id !== "handheld" && re.test(text)).map(([, id]) => cameraById(id).words);
    if (moves.length) issues.push({ level: "warning", code: "fixed-lens-moves", message: `Fixed lens is on, but the prompt asks for camera moves (${moves.slice(0, 3).join(", ")}). The camera will stay still.` });
  }
  if (ctx.audio === false && /"[^"]{3,}"|“[^”]{3,}”/.test(text)) issues.push({ level: "warning", code: "speech-without-sound", message: "Sound is off, so the spoken line in quotes will not be heard. Turn sound on or remove the line." });
  return issues;
}

/**
 * Explains, before anything is paid, what BytePlus will refuse (errors) and what will probably disappoint (warnings).
 * Faces cannot be detected here: reference labels that look like people get a warning.
 */
export function checkSeedanceRequest(req: SeedanceRequest, ctx: { referenceNotes?: string[] } = {}): { ok: boolean; issues: SeedanceIssue[]; estimateUsd: number } {
  const issues: SeedanceIssue[] = [];
  const err = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warning", code, message });
  const model = SEEDANCE_MODELS[req.tier];
  if (!model) err("tier", `Unknown quality "${String(req.tier)}". Choose Mini, Fast or Pro.`);
  if (!(SEEDANCE_RATIOS as readonly string[]).includes(req.ratio)) err("ratio", `Seedance cannot make the shape ${req.ratio}. Choose 9:16, 3:4, 1:1, 4:3, 16:9, 21:9 or adaptive.`);
  if (!Number.isFinite(req.seconds) || req.seconds < SEEDANCE_LIMITS.minSeconds || req.seconds > SEEDANCE_LIMITS.maxSeconds || !Number.isInteger(req.seconds)) {
    const sent = Math.min(SEEDANCE_LIMITS.maxSeconds, Math.max(SEEDANCE_LIMITS.minSeconds, Math.round(Number(req.seconds) || 5)));
    warn("seconds", `Seedance makes clips of ${SEEDANCE_LIMITS.minSeconds} to ${SEEDANCE_LIMITS.maxSeconds} whole seconds; ${req.seconds} s will be sent as ${sent} s. Longer videos are joined from several clips.`);
  }
  if (model && !(model.resolutions as readonly string[]).includes(req.resolution) && !req.draft) err("resolution", `${model.name} makes ${model.resolutions.join(" or ")}; ${req.resolution} needs ${SEEDANCE_MODELS.pro.name} (Pro).`);
  // BytePlus's draft mode is Seedance 2.5 and 1.5 pro only: on the 2.0 series a "draft" is a normal 480p clip.
  if (req.draft) warn("draft-resolution", `Seedance 2.0 has no draft mode: this is made as a normal 480p clip${req.resolution !== "480p" ? ` (not ${req.resolution})` : ""} and costs as one. Make the ${req.resolution === "480p" ? "final" : req.resolution} clip after.`);
  if (req.seed !== undefined && req.seed !== null && (!Number.isInteger(req.seed) || req.seed < -1 || req.seed > 4294967295)) err("seed", "The seed must be a whole number from -1 to 4294967295 (or empty for a random one).");

  const imgs = req.references.filter((r) => r.kind === "image");
  const vids = req.references.filter((r) => r.kind === "video");
  const auds = req.references.filter((r) => r.kind === "audio");
  if (imgs.length > SEEDANCE_LIMITS.maxImages) err("too-many-images", `${imgs.length} photos attached; Seedance takes at most ${SEEDANCE_LIMITS.maxImages}.`);
  if (vids.length > SEEDANCE_LIMITS.maxVideos) err("too-many-videos", `${vids.length} videos attached; Seedance takes at most ${SEEDANCE_LIMITS.maxVideos}.`);
  if (auds.length > SEEDANCE_LIMITS.maxAudio) err("too-many-audio", `${auds.length} audio files attached; Seedance takes at most ${SEEDANCE_LIMITS.maxAudio}.`);
  if (auds.length && !imgs.length && !vids.length) err("audio-alone", "Audio references need at least one photo or video with them.");
  const firsts = imgs.filter((r) => r.role === "first_frame").length;
  const lasts = imgs.filter((r) => r.role === "last_frame").length;
  if (firsts > 1 || lasts > 1) err("frames", "Only one opening frame and one closing frame can be set.");
  if (lasts && !firsts) err("last-without-first", "A closing frame needs an opening frame too (first + last mode).");
  // The API reference: first frame, first + last frames and omni reference (images, videos, audio) cannot be mixed;
  // reference images may still be marked first/last frame, so only videos and audio with frames are refused.
  if ((firsts || lasts) && (vids.length || auds.length)) err("mixed-modes", "Opening/closing frames cannot be mixed with reference videos or audio (different Seedance modes). Use either the frames or the references.");
  else if ((firsts || lasts) && imgs.length > firsts + lasts) warn("mixed-modes", "Opening/closing frames with other reference images: BytePlus treats this as an omni reference and may refuse the mix. Use either first/last frames or references.");
  for (const v of vids) if (v.url.startsWith("data:")) err("video-inline", "BytePlus takes reference videos only as a public link or a digital character (asset://), not uploaded inside the request. Start the video.bupulse.com tunnel (STUDIO_PUBLIC_URL) or remove the video.");
  for (const a of auds) if (a.url.startsWith("data:") && !/^data:audio\/(wav|mp3);base64,/.test(a.url)) err("audio-format", "Seedance takes .mp3 or .wav audio (sent as data:audio/mp3 or data:audio/wav).");
  for (const i of imgs) if (i.url.startsWith("data:") && !/^data:image\/(jpeg|png|webp|bmp|tiff|gif|heic|heif);base64,/.test(i.url)) err("image-format", "Seedance takes jpeg, png, webp, bmp, tiff, gif or heic photos (the format written in lowercase).");
  if (req.ratio === "adaptive" && !imgs.length && !vids.length) warn("adaptive-text", "Adaptive takes the shape from the first photo; with text only, choose 9:16 for Reels and TikTok.");
  const bigImage = imgs.find((r) => r.url.startsWith("data:") && (r.url.length * 3) / 4 > 30 * 1024 * 1024);
  if (bigImage) err("image-size", "A photo is over 30 MB; BytePlus refuses it. Use a smaller photo.");
  const totalBytes = req.references.reduce((a, r) => a + (r.url.startsWith("data:") ? (r.url.length * 3) / 4 : 0), 0);
  if (totalBytes > 64 * 1024 * 1024) err("request-size", `The references add up to about ${Math.round(totalBytes / 1024 / 1024)} MB; BytePlus takes a request of 64 MB at most. Use fewer or smaller files.`);
  else if (totalBytes > 48 * 1024 * 1024) warn("request-size", `The references add up to about ${Math.round(totalBytes / 1024 / 1024)} MB, close to BytePlus's 64 MB limit.`);

  const notes = ctx.referenceNotes ?? [];
  const people = notes.filter((n, i) => PERSON_REF.test(n) && !/asset:/i.test(n) && !/asset:\/\//.test(req.references[i]?.url ?? ""));
  if (people.length) warn("faces", `${people.map((n) => n.split(":")[0]).join(", ")} may show a person. BytePlus refuses real-looking human faces in references (AI-made portraits too). Use the digital character library (asset://...) for people.`);
  else if (imgs.some((r) => !r.url.startsWith("asset://"))) issues.push({ level: "info", code: "faces-unchecked", message: "Photos with a real person's face are refused by BytePlus. We cannot check faces here: use photos of products and places only." });

  issues.push(...lintSeedancePrompt(req.prompt, { seconds: Math.round(req.seconds), images: imgs.length, videos: vids.length, audios: auds.length, fixedLens: req.fixedLens, audio: req.audio }));
  if (req.flex) warn("flex", "Offline (flex, half price) is not available on Seedance 2.0 yet: it runs online at the normal price.");
  if (req.fixedLens) issues.push({ level: "info", code: "fixed-lens", message: "Seedance 2.0 has no fixed-camera switch; BuPulse asks for a static camera in the prompt instead." });
  return { ok: !issues.some((i) => i.level === "error"), issues, estimateUsd: model ? estimateSeedanceUsd({ tier: req.tier, resolution: req.draft ? "480p" : req.resolution, seconds: Math.min(SEEDANCE_LIMITS.maxSeconds, Math.max(SEEDANCE_LIMITS.minSeconds, Math.round(req.seconds))) }) : 0 };
}
