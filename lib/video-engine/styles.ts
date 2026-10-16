// Hooks (and, as templates, styles) of the Claude video engine (docs/VIDEO_ENGINE.md): named presets, like Higgsfield's Marketing
// Studio, each a short art direction for the designer. Written for small businesses in Rwanda and East Africa.
// Data only; the designer (designer.ts) adds the chosen ones to Claude's brief.

import { VIDEO_TEMPLATES, templateById } from "./templates";

/** Styles are now the templates (templates.ts); kept for the code that names them styles. */
export type VideoStyle = { id: string; name: string; blurb: string; direction: string };
export const VIDEO_STYLES: VideoStyle[] = VIDEO_TEMPLATES;

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
  { id: "product-hit", name: "Product hit", direction: "The product flies into frame and slams to a stop (scale and dx keyframes with ease back, a flash), then the hook text pops." },
  { id: "stop-scroll", name: "Stop scrolling", direction: "Open with 'Stop scrolling' or a similar direct call, crashZoom, then the reason in the next beat." },
  { id: "did-you-know", name: "Did you know?", direction: "Open with 'Did you know...' and a surprising true fact from the brief, typewriter text, focus pull." },
  { id: "reveal", name: "Big reveal", direction: "Open on darkness or a blurred close-up, then reveal the product with blurZoom and glow." },
];

export const styleById = (id: string): VideoStyle => templateById(id);
export const hookById = (id: string): VideoHook => VIDEO_HOOKS.find((h) => h.id === id) ?? VIDEO_HOOKS[0];
