// Sample content for previewing the design library (admin gallery, render tests): a made-up bakery in four brand
// palettes, with a generated "photo" so no image asset ships with the app.
import type { Angle } from "./catalog";
import type { DesignInput } from "./kit";

export const SAMPLE_PALETTES: { name: string; colors: string[] }[] = [
  { name: "Orange and gold", colors: ["#E4572E", "#F3A712"] },
  { name: "Navy", colors: ["#1D3557", "#457B9D", "#A8DADC"] },
  { name: "Pale yellow", colors: ["#FFE66D"] },
  { name: "None (BuPulse blue)", colors: [] },
];

const TEXTS: Partial<Record<Angle, Pick<DesignInput, "headline" | "subline" | "chip" | "kicker">>> = {
  price: { headline: "Fresh sourdough every morning", subline: "Baked slowly, sold warm", chip: "RWF 4,500", kicker: "Special offer" },
  event: { headline: "Bread-making workshop", subline: "Kigali Heights · 10 am to 1 pm", chip: "Sat 14 June", kicker: "You are invited" },
  quote: { headline: "The best croissant in town, every single time.", subline: "Amina, customer" },
  testimonial: { headline: "The best croissant in town, every single time.", subline: "Amina, customer" },
  tips: { headline: "Keep bread in a cloth bag, never the fridge", subline: "It stays soft for three days and the crust keeps its crunch.", kicker: "Tip" },
  "how-it-works": { headline: "Order before 8 pm, collect at 7 am", subline: "Pay by MoMo · Pick up warm · No queue" },
  feature: { headline: "Why our bread lasts longer", subline: "Slow fermentation · Local flour · No additives · Baked daily" },
};

const DEFAULT_TEXT = { headline: "Fresh sourdough every morning", subline: "Baked slowly · Sold warm · Free delivery", chip: "From RWF 3,000", kicker: "New in" };

export function sampleInput(angle: Angle, palette = 0, photoDataUrl: string | null = null): DesignInput {
  return { businessName: "Sunrise Bakery", colors: SAMPLE_PALETTES[palette % SAMPLE_PALETTES.length].colors, photoDataUrl, step: angle === "tips" || angle === "how-it-works" ? 2 : null, ...DEFAULT_TEXT, ...TEXTS[angle] };
}

/** A soft gradient "photo" for previews, as an element for next/og to draw. */
export const SAMPLE_PHOTO_STYLE = {
  display: "flex",
  width: "100%",
  height: "100%",
  backgroundImage:
    "radial-gradient(circle at 30% 35%, #f4d35e 0%, rgba(244,211,94,0) 28%), radial-gradient(circle at 75% 70%, #ee964b 0%, rgba(238,150,75,0) 30%), linear-gradient(160deg, #1d3557, #e63946 60%, #f1faee)",
} as const;
