// Real-looking people (owner, 11 Nov 2026: the old characters looked like AI slop). Every character and scene picture
// uses the prompt below; the brain writes characters by docs/research/ad-formats.json `realHumanGuide`, and what it
// writes is cleaned of the words that make pictures look generated ("cinematic", "flawless", "airbrushed"...). Pure.
//
// Skin (12-13 Nov 2026, the Higgsfield comparison, memory higgsfield-lessons): skin reads as real from LIGHT, not from
// texture. Asking for "visible pores, tiny blemishes, sensor grain" painted an even pattern of dots over every face
// (it read as a texture, "not a skin"), and "natural available light only" plus a ban on lighting words left dark skin
// flat and grey. So: a soft key light from one side, a warm practical lamp behind, natural sheen on the high points,
// warm undertones, sharp eyes; no pores, blemishes or grain asked for, and those words are cleaned out of the brain's.

/** The photo prompt for every person picture: real light and real skin at arm's length, not a texture. */
export const REAL_PERSON_PHOTO =
  "Candid, unposed photo taken on an iPhone by a friend. Soft daylight from a window to one side lights the face, the far cheek falls into gentle shadow, a warm lamp glows somewhere behind. True-to-life dark skin with warm red-brown undertones and a natural healthy sheen on the forehead, nose and cheekbones, real skin seen at arm's length with natural variation in tone, fine flyaway hairs, sharp focus on the eyes. Real everyday clothes with natural creases, lived-in real Kigali background, slightly off-centre framing. Not retouched, no beauty filter, no airbrushing, no glow, no plastic or waxy skin, no perfect symmetry, no cinematic colour grade. Ordinary believable person, not a model.";

/** Always added: no text drawn by the model, and no AI-drawn screens (hard rule 1). */
export const NO_TEXT_NO_SCREENS = "No text, no logos, no watermarks, no extra fingers. Any phone, laptop, monitor or TV screen faces away from the camera or is out of shot.";

/** The video side of the guide (Higgsfield Sora 2 notes in the research): a real phone, not a camera crew. */
export const REAL_PHONE_VIDEO =
  "Shot on an iPhone, handheld, slightly shaky, autofocus micro-pulses, no stabilization. Soft window light from one side of the face, a warm lamp in the background, natural sheen on the skin. Real micro-expressions, natural blinks, small glances away, a small laugh or a breath before speaking. Not cinematic, no colour grade, no beauty filter. No on-screen text, no music. Any phone, laptop, monitor or TV screen stays facing away from the camera.";

/** The guide's "do" list, for the brain's character and scene writing (from the research, shortened). */
export const CHARACTER_GUIDE = [
  "an ordinary Rwandan adult with a specific age and build, short natural hair or braids, not model-perfect",
  "exact everyday wardrobe (e.g. 'faded green t-shirt with a small stain, plain cap, simple earrings')",
  "a real Kigali place: a tin-roofed shop, red dust, motorbikes, plastic chairs, wall posters, mixed clutter",
  "soft window light from one side of the face, a warm lamp behind, natural sheen on the forehead and cheekbones",
  "asymmetric framing, partly cut-off head, off-centre subject",
  "natural gestures, blinks, glances away, small laughs, starting mid-sentence",
];

/** Words that make a picture look generated, removed from anything the brain writes for a picture or clip. Lighting
 *  words are allowed (good light is what makes skin real); only the airbrushed/stock look stays out. */
const SLOP = /\b(cinematic|professional(?:ly)?|8k|4k|ultra[- ]?realistic|hyper[- ]?realistic|photorealistic|perfect skin|flawless|airbrushed|studio (?:backdrop|shot|portrait)|glossy skin|beauty filter|bokeh|model-like|supermodel|stunning|gorgeous|magazine)\b/gi;

/** Skin words that paint a pattern of dots over the face instead of skin (removed too). "grain" and "noisy" alone stay: a shop
 *  can sell sacks of grain, a market can be noisy. */
const FAKE_SKIN = /\b((?:with )?(?:visible |large |open )?pores|(?:tiny |small |faint |a few )?blemish(?:es)?|acne|(?:sensor|film|camera) grain|grainy|uneven skin tone|skin texture)\b/gi;

/** The brain's character or scene words with the slop words taken out (and their leftover commas tidied). */
export function realistic(text: string | null | undefined): string {
  return (text ?? "")
    .replace(SLOP, "")
    .replace(FAKE_SKIN, "")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

/** True when a description still carries a slop word (for the tests and the script check). */
export const hasSlopWords = (text: string) => new RegExp(SLOP.source, "i").test(text) || hasFakeSkinWords(text);

/** True when a prompt asks for pores, blemishes or grain (the "texture, not a skin" look). */
export const hasFakeSkinWords = (text: string) => new RegExp(FAKE_SKIN.source, "i").test(text);
