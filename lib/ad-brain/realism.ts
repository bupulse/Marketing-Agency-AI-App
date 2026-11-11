// Real-looking people (owner, 11 Nov 2026: the old characters looked like AI slop). The proven prompt below scored
// "people look real" 10/10 that day and is the default for every character and scene picture; the brain writes
// characters by docs/research/ad-formats.json `realHumanGuide`, and what it writes is cleaned of the words that make
// pictures look generated ("cinematic", "flawless", "studio lighting"...). Pure.

/** The owner's proven photo prompt (wording kept as given). */
export const REAL_PERSON_PHOTO =
  "Candid, unposed photo taken on an iPhone by a friend, natural available light only, slight sensor grain, true-to-life dark skin with visible pores, uneven skin tone, tiny blemishes and fine flyaway hairs, real everyday clothes with natural creases, lived-in real Kigali background, slightly off-centre framing. Not a studio photo, not retouched, no beauty filter, no glow, no plastic or waxy skin, no perfect symmetry, no cinematic colour grade. Ordinary believable person, not a model.";

/** Always added: no text drawn by the model, and no AI-drawn screens (hard rule 1). */
export const NO_TEXT_NO_SCREENS = "No text, no logos, no watermarks, no extra fingers. Any phone, laptop, monitor or TV screen faces away from the camera or is out of shot.";

/** The video side of the guide (Higgsfield Sora 2 notes in the research): a real phone, not a camera crew. */
export const REAL_PHONE_VIDEO =
  "Shot on an iPhone, handheld, slightly shaky, autofocus micro-pulses, no stabilization, natural available light. Real micro-expressions, natural blinks, small glances away, a small laugh or a breath before speaking. Not cinematic, no colour grade, no beauty filter. No on-screen text, no music. Any phone, laptop, monitor or TV screen stays facing away from the camera.";

/** The guide's "do" list, for the brain's character and scene writing (from the research, shortened). */
export const CHARACTER_GUIDE = [
  "an ordinary Rwandan adult with a specific age and build, short natural hair or braids, not model-perfect",
  "exact everyday wardrobe (e.g. 'faded green t-shirt with a small stain, plain cap, simple earrings')",
  "a real Kigali place: a tin-roofed shop, red dust, motorbikes, plastic chairs, wall posters, mixed clutter",
  "soft natural window daylight, mixed light, slightly warm",
  "asymmetric framing, partly cut-off head, off-centre subject",
  "natural gestures, blinks, glances away, small laughs, starting mid-sentence",
];

/** Words that make a picture look generated, removed from anything the brain writes for a picture or clip. */
const SLOP = /\b(cinematic|professional(?:ly)?|8k|4k|ultra[- ]?realistic|hyper[- ]?realistic|photorealistic|perfect skin|flawless|airbrushed|studio (?:lighting|light|backdrop|shot)|ring[- ]?light|glossy skin|beauty filter|bokeh|model-like|supermodel|stunning|gorgeous|magazine)\b/gi;

/** The brain's character or scene words with the slop words taken out (and their leftover commas tidied). */
export function realistic(text: string | null | undefined): string {
  return (text ?? "")
    .replace(SLOP, "")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

/** True when a description still carries a slop word (for the tests and the script check). */
export const hasSlopWords = (text: string) => new RegExp(SLOP.source, "i").test(text);
