// Generates the demo businesses' product photos with Gemini (same API the app uses in lib/ai/gemini-image.ts).
// Usage: node gen-photos.mjs [name ...]   (skips photos that already exist)
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { ROOT } from "./db.mjs";

const OUT = path.join(ROOT, "Demo/capture/assets/photos");
const STYLE = "Realistic professional product photo, natural soft daylight, shallow depth of field, high detail, no text, no watermark, no logos.";
export const PHOTOS = {
  "inzu-dress-1": "A woman's knee-length kitenge (African wax print) summer dress in terracotta, mustard and cream patterns, displayed on a mannequin in a bright small boutique in Kigali, Rwanda. " + STYLE,
  "inzu-dress-2": "A young Rwandan woman smiling, wearing a vibrant kitenge wrap dress in orange and gold print, standing on a sunny street with green plants, fashion lookbook photo. " + STYLE,
  "inzu-dress-3": "Flat lay of a folded kitenge dress in terracotta and gold wax print fabric with gold earrings and a woven straw bag on a cream linen background. " + STYLE,
  "inzu-shirt": "A men's short-sleeve shirt in blue and orange African wax print, on a wooden hanger against a warm plaster wall. " + STYLE,
  "inzu-accessories": "African print accessories: a head wrap, beaded bracelets and a small kitenge clutch bag arranged on a wooden table. " + STYLE,
  "urugo-house": "Exterior of a modern 3-bedroom family house in Kibagabaga, Kigali, Rwanda, red brick and white render, garden with green lawn and bougainvillea, gated driveway, blue sky, hills in the background, real estate photography. " + STYLE,
  "urugo-living": "Bright modern living room of a house in Kigali, large windows, grey sofa, wooden floor, indoor plants, real estate interior photography. " + STYLE,
  "urugo-apartment": "Modern apartment building balcony view in Kimihurura, Kigali, two-bedroom apartment interior with open kitchen and city view at golden hour, real estate photography. " + STYLE,
  "urugo-villa": "Modern 4-bedroom villa with a swimming pool in Nyarutarama, Kigali, Rwanda, at sunset, real estate photography. " + STYLE,
  "nova-a56": "A modern mid-range Android smartphone with a triple camera on the back, in light blue, standing on a clean white display stand in a phone shop, studio lighting. Generic phone design, no brand logos. " + STYLE,
  "nova-iphone": "A premium smartphone with a dual camera, black titanium finish, lying on a dark glossy surface with blue rim light, studio product photo. No brand logos. " + STYLE,
  "nova-accessories": "Phone accessories flat lay: fast USB-C chargers, braided cables, colourful silicone phone cases and wireless earbuds on a black background with blue accent light. No brand logos. " + STYLE,
  "nova-shop": "Interior of a bright, modern phone and accessories shop in Kigali with glass display counters, phones on stands and blue LED shelf lighting. No readable brand names. " + STYLE,
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PHOTOS);
for (const name of names) {
  const file = path.join(OUT, `${name}.png`);
  if (fs.existsSync(file)) continue;
  const res = await ai.interactions.create(
    { model, input: [{ type: "text", text: PHOTOS[name] }], store: false, response_format: { type: "image", aspect_ratio: "1:1" } },
    { timeout: 120_000 },
  );
  const img = (res.steps ?? []).flatMap((s) => (s.type === "model_output" ? (s.content ?? []) : [])).find((c) => c.type === "image" && c.data);
  if (!img) { console.error(name, "no image", res.status); continue; }
  fs.writeFileSync(file, Buffer.from(img.data, "base64"));
  console.log("saved", name, img.mime_type);
}
