// Styles and hooks of the Claude video engine (docs/VIDEO_ENGINE.md): named presets, like Higgsfield's Marketing
// Studio, each a short art direction for the designer. Written for small businesses in Rwanda and East Africa.
// Data only; the designer (designer.ts) adds the chosen ones to Claude's brief.

export type VideoStyle = { id: string; name: string; blurb: string; direction: string };

export const VIDEO_STYLES: VideoStyle[] = [
  {
    id: "product-hero",
    name: "Product hero",
    blurb: "The product floats in, turns and shines; features appear around it.",
    direction:
      "Premium product showcase. Product photo as the hero, large and centred (fit contain on a clean gradient or solid background when the photo has a plain background, cover when it is a lifestyle photo). Slow rotate (-4 to 4 degrees) and scale (0.9 to 1.05) keyframes so it feels alive. Feature callouts slide in beside it with thin lines (shape line, draw true). Rich but restrained colours from the brand.",
  },
  {
    id: "kinetic-type",
    name: "Bold words",
    blurb: "Big words punch in on the beat; photos flash between them.",
    direction:
      "Kinetic typography. Each scene is short (1.2 to 2.5 s) with 1 to 4 huge words (size 0.12 to 0.2) in Anton or Poppins 800, uppercase, animated with wordsPop, pop or zoom. Alternate strong solid background colours between scenes, flash or cut transitions. Product photos appear in quick cut scenes between the words. Rhythm matters more than detail.",
  },
  {
    id: "dark-minimal",
    name: "Dark minimal",
    blurb: "Black background, elegant serif, slow and luxurious.",
    direction:
      "Luxury minimalism. Near-black backgrounds (#0b0b0b to #1a1a1a), one thin accent colour (gold, cream or the brand colour). Playfair or DM Serif for headlines, Inter for small lines. Slow fades and blurIn, long scenes (3 to 5 s), lots of empty space, photos with rounded corners and soft shadows, slow zoomTo 1.1. Never more than 6 words on screen.",
  },
  {
    id: "colour-pop",
    name: "Colour pop",
    blurb: "Bright colour blocks, bouncy stickers and a price burst.",
    direction:
      "Playful and loud. Bright saturated backgrounds that change every scene, blobs and bursts as stickers behind the product, bouncy keyframes (ease back, bounce, elastic), wordsPop text with highlight on the key word, a burst shape behind a price or offer. Poppins or Nunito 800. Fun, young, energetic.",
  },
  {
    id: "offer-flash",
    name: "Offer flash",
    blurb: "A sale or offer, loud and clear, ending with how to buy.",
    direction:
      "A promotion ad. Hook with the offer itself in huge text (only offers, prices and dates present in the facts). Show the product, then 2 to 3 short reasons to buy now, then a strong closing scene with the price or offer in a burst and how to order (phone, WhatsApp, shop location if given). Fast cuts and slideUp transitions, high contrast, accent colour for prices.",
  },
  {
    id: "story-cinematic",
    name: "Cinematic story",
    blurb: "Full-screen photos with slow movement and calm captions.",
    direction:
      "Cinematic slideshow. Full-screen photo backgrounds (or photo layers covering the canvas) with slow zoomTo 1.12 towards the subject, a dim of 0.2 to 0.35, fade transitions. Captions in the lower third, Inter 600 or Playfair, rise or words animation, short sentences that tell a small story (a problem, the product, the result).",
  },
  {
    id: "benefits-list",
    name: "3 reasons",
    blurb: "A numbered list of benefits that tick in one by one.",
    direction:
      "List video. Hook scene with a question or promise, then one scene per benefit (3 at most): a big number (1, 2, 3) in the accent colour, the benefit in 3 to 7 words, the product photo beside or below. Ring or circle shapes behind the numbers, consistent layout across the benefit scenes so it feels like a series. End with the product and the call to action.",
  },
  {
    id: "kigali-market",
    name: "Local market",
    blurb: "Warm earthy colours and a friendly local feel.",
    direction:
      "Warm and local. Earthy palette (terracotta, ochre, deep green, cream) unless the brand says otherwise, textured backgrounds (dots or lines), rounded photo frames, friendly Nunito text. Speak like a neighbour recommending a good shop. A greeting in the business's language may open the video (for Kinyarwanda: Muraho!). End with where to find the business.",
  },
];

export type VideoHook = { id: string; name: string; direction: string };

/** Openers for the first 2 seconds: what makes someone stop scrolling. */
export const VIDEO_HOOKS: VideoHook[] = [
  { id: "auto", name: "Let Claude choose", direction: "Choose the strongest opener for this product and audience." },
  { id: "question", name: "A question", direction: "Open with a short question the customer asks themselves (problem or desire), in huge text." },
  { id: "bold-claim", name: "Bold claim", direction: "Open with the boldest true benefit in 3 to 5 words, punched in with pop or wordsPop." },
  { id: "price-reveal", name: "Price reveal", direction: "Open by teasing the price or offer, then reveal it with a burst (only if a price or offer is in the facts; otherwise use a bold claim)." },
  { id: "before-after", name: "Problem, then fix", direction: "Open with the everyday problem (text on a dull background), then cut hard to the product as the fix (bright scene). No medical or body before-and-after." },
  { id: "pov", name: "POV", direction: "Open with 'POV:' and a relatable everyday moment of the customer, then show the product as part of that moment." },
  { id: "countdown", name: "Countdown", direction: "Open with '3 reasons' or 'Top 3' style promise and count through them quickly." },
];

export const styleById = (id: string): VideoStyle => VIDEO_STYLES.find((s) => s.id === id) ?? VIDEO_STYLES[0];
export const hookById = (id: string): VideoHook => VIDEO_HOOKS.find((h) => h.id === id) ?? VIDEO_HOOKS[0];
