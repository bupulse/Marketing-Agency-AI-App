// Video Lab (docs/VIDEO_ENGINE.md, "AI influencers"): a library of fictional East African presenters made as realistic
// photos with Gemini (the image model BuPulse already uses), and "shots" of a presenter holding or using a product,
// made from the presenter's portrait and the product photo so face and product stay the same. The shots become
// reference photos that Claude places in the video with camera moves and captions (no lip movement: that is
// Seedance's job, later). Owner decision, 16 October 2026: realistic photo influencers and cartoon presenters, both.
//
// Paid: about $0.039 a Gemini image (gemini-2.5-flash-image, lib/ai/pricing.ts), counted in the lab's ledger and cap.
// Rules from lib/designs/prompt.ts: fictional adults only, never a real or famous person or a lookalike, respectful
// everyday clothing, no text or logos.
import fs from "node:fs/promises";
import path from "node:path";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { saveUpload } from "./data-source";

const DATA = path.resolve("video-lab/data/influencers");
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

export type Influencer = { id: string; name: string; gender: "woman" | "man"; age: number; look: string; vibe: string; place: string };

/** Fictional presenters. Ages and looks are adult and everyday; names are common Rwandan first names. */
export const INFLUENCERS: Influencer[] = [
  { id: "aline", name: "Aline", gender: "woman", age: 26, look: "short natural hair, warm smile, light natural makeup, a modern ankara-print top", vibe: "fashion and beauty, bright and friendly", place: "a sunny Kigali cafe with plants" },
  { id: "eric", name: "Eric", gender: "man", age: 30, look: "short fade haircut, neat beard, smart casual shirt", vibe: "tech and gadgets, confident and curious", place: "a modern Kigali co-working space" },
  { id: "grace", name: "Grace", gender: "woman", age: 38, look: "braided hair tied back, kind face, simple elegant dress", vibe: "home and family, warm and trusted", place: "a bright family living room in Kigali" },
  { id: "kevin", name: "Kevin", gender: "man", age: 23, look: "short twists, streetwear hoodie and a cap", vibe: "young, energetic, trends and music", place: "a colourful street in Nyamirambo, Kigali" },
  { id: "diane", name: "Diane", gender: "woman", age: 33, look: "sleek bob haircut, professional blazer", vibe: "business and services, clear and professional", place: "a modern office with a view of Kigali hills" },
  { id: "patrick", name: "Patrick", gender: "man", age: 45, look: "short grey-flecked hair, polo shirt, friendly grin", vibe: "shop owner, honest and reassuring", place: "a tidy small shop counter in Kigali" },
  { id: "sandrine", name: "Sandrine", gender: "woman", age: 24, look: "long braids, sporty athleisure outfit", vibe: "fitness and wellness, upbeat", place: "an outdoor terrace with Kigali hills behind" },
  { id: "jean-paul", name: "Jean-Paul", gender: "man", age: 28, look: "short hair, apron over a casual shirt", vibe: "food and cooking, playful", place: "a warm home kitchen in Kigali" },
];

export const SHOT_ACTIONS = [
  { id: "holding", text: "holding the product up near their face and smiling at the camera" },
  { id: "showing", text: "showing the product towards the camera with one hand, pointing at it with the other, excited" },
  { id: "using", text: "using the product naturally, mid-moment, candid" },
  { id: "unboxing", text: "opening a box and lifting the product out, surprised and happy" },
  { id: "selfie", text: "taking a selfie-style video with the product visible, talking to the camera" },
] as const;

const SAFETY = "A fictional adult, not a real or famous person and not a lookalike of anyone. Respectful everyday clothing. Nothing medical. No text, no watermark, and never add or change a brand logo: only marks already on the product photo.";

const dir = (id: string) => path.join(DATA, id);
const known = (id: string) => INFLUENCERS.find((i) => i.id === id);

export type ImageCall = { model: string; inputTokens: number; outputTokens: number; costUsd: number };

/** One Gemini image: references (base64 JPEG) and a prompt in, a JPEG/PNG out, with its cost. */
async function geminiImage(prompt: string, references: Buffer[], aspectRatio: string): Promise<{ bytes: Buffer; call: ImageCall }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env.");
  const res = await fetch(`${GEMINI_API}/interactions`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: MODEL,
      input: [...references.map((b) => ({ type: "image", mime_type: "image/jpeg", data: b.toString("base64") })), { type: "text", text: prompt }],
      store: false,
      response_format: { type: "image", aspect_ratio: aspectRatio },
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new Error("Gemini did not answer in time. Try again.");
  });
  if (!res.ok) throw new Error(res.status === 429 ? "Gemini is busy or the image allowance is used. Try later." : `Gemini could not make the image (${res.status}).`);
  const body = (await res.json()) as { steps?: { type: string; content?: { type: string; data?: string }[] }[]; usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number } };
  const usage = { inputTokens: body.usage?.total_input_tokens ?? 0, outputTokens: (body.usage?.total_output_tokens ?? 0) + (body.usage?.total_thought_tokens ?? 0), images: 1 };
  const call: ImageCall = { model: MODEL, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: estimateCostUsd(MODEL, usage) };
  const image = (body.steps ?? []).flatMap((s) => (s.type === "model_output" ? (s.content ?? []) : [])).find((c) => c.type === "image" && c.data);
  if (!image?.data) throw Object.assign(new Error("Gemini returned no image (it may have declined the request)."), { call });
  return { bytes: Buffer.from(image.data, "base64"), call };
}

// ---- AI image page (Nano Banana, /app/image/nano-banana) -------------------------------------------------------------
const IMAGES = path.resolve("video-lab/data/images/index.json");
/** Shapes Gemini makes natively. */
export const IMAGE_RATIOS = ["1:1", "4:5", "3:4", "9:16", "16:9"] as const;
const IMAGE_RULES = "Any person shown is a fictional adult, not a real or famous person and not a lookalike of anyone, in respectful everyday clothing. No watermark. Never add or change a brand logo: only marks already on a reference photo.";

/**
 * A generic image: a prompt and up to 3 reference photos (JPEG), with the same safety rules as the presenters. One
 * image (about $0.039). Products in the references keep their look.
 */
export async function generateImage(prompt: string, references: Buffer[], aspectRatio: string): Promise<{ bytes: Buffer; call: ImageCall }> {
  const refs = references.slice(0, 3);
  const names = refs.map((_, k) => `Image ${k + 1}`).join(", ");
  const text = `${refs.length ? `The reference photos are ${names}, in that order. Any product in them must stay exactly as photographed: same shape, colours and labels, not redrawn. ` : ""}${prompt.slice(0, 1500)}\n\nPhotorealistic, unless the request asks for another style. ${IMAGE_RULES}`;
  return geminiImage(text, refs, aspectRatio);
}

export type GalleryImage = { id: string; at: string; prompt: string; ratio: string; references: number; costUsd: number };

export async function listImages(): Promise<GalleryImage[]> {
  try {
    return JSON.parse(await fs.readFile(IMAGES, "utf8")) as GalleryImage[];
  } catch {
    return [];
  }
}

export async function addImage(image: GalleryImage): Promise<void> {
  const all = [image, ...(await listImages())].slice(0, 200);
  await fs.mkdir(path.dirname(IMAGES), { recursive: true });
  await fs.writeFile(IMAGES, JSON.stringify(all, null, 2));
}

export type InfluencerView = Influencer & { portrait: boolean; shots: { id: string; product: string; action: string }[] };

export async function listInfluencers(): Promise<InfluencerView[]> {
  return Promise.all(
    INFLUENCERS.map(async (i) => {
      const portrait = await fs.access(path.join(dir(i.id), "portrait.jpg")).then(() => true, () => false);
      let shots: InfluencerView["shots"] = [];
      try {
        shots = JSON.parse(await fs.readFile(path.join(dir(i.id), "shots.json"), "utf8"));
      } catch {
        // No shots yet.
      }
      return { ...i, portrait, shots };
    }),
  );
}

export async function portraitBytes(id: string): Promise<Buffer | null> {
  if (!known(id)) return null;
  return fs.readFile(path.join(dir(id), "portrait.jpg")).catch(() => null);
}

/** Makes (or remakes) the presenter's portrait: the face every later shot keeps. One image. */
export async function makePortrait(id: string): Promise<ImageCall> {
  const i = known(id);
  if (!i) throw new Error("Unknown influencer.");
  const prompt = `Photorealistic vertical portrait photo of ${i.name}, a fictional Rwandan ${i.gender}, about ${i.age} years old, ${i.look}, in ${i.place}. Looking at the camera, natural expression, ${i.vibe}. Shot on a modern smartphone, natural light, shallow depth of field, realistic skin texture, upper body visible. ${SAFETY}`;
  const { bytes, call } = await geminiImage(prompt, [], "3:4");
  await fs.mkdir(dir(id), { recursive: true });
  const sharp = (await import("sharp")).default;
  await fs.writeFile(path.join(dir(id), "portrait.jpg"), await sharp(bytes).jpeg({ quality: 90 }).toBuffer());
  return call;
}

/**
 * A shot of the presenter with the product (both references, so the face and the product stay the same). Saved as an
 * upload, so it appears in the lab's references with a note Claude reads. One image.
 */
export async function makeShot(id: string, product: { name: string; photo: Buffer }, actionId: string, setting: string | null, aspectRatio: string): Promise<{ uploadId: string; call: ImageCall }> {
  const i = known(id);
  if (!i) throw new Error("Unknown influencer.");
  const portrait = await portraitBytes(id);
  if (!portrait) throw new Error(`Make ${i.name}'s portrait first.`);
  const action = SHOT_ACTIONS.find((a) => a.id === actionId) ?? SHOT_ACTIONS[0];
  const place = (setting || i.place).replace(/[^\p{L}\p{N} ,.'-]/gu, "").slice(0, 120);
  const prompt = `Photorealistic vertical UGC-style smartphone photo. The person is exactly the same person as in the first image (same face, hair, skin tone and age, and the same clothes). The product is exactly the product in the second image (${product.name.replace(/[^\p{L}\p{N} ,.'-]/gu, "").slice(0, 80)}): same shape, colours and labels, not redrawn. ${i.name} is ${action.text}, in ${place}, Rwanda. Candid, natural light, realistic, a little handheld. ${SAFETY}`;
  const { bytes, call } = await geminiImage(prompt, [portrait, product.photo], aspectRatio);
  const up = await saveUpload(bytes, `${i.name} (AI presenter) ${action.text}, with ${product.name}`);
  const shots = (await listInfluencers()).find((x) => x.id === id)?.shots ?? [];
  shots.unshift({ id: up.id, product: product.name, action: action.id });
  await fs.writeFile(path.join(dir(id), "shots.json"), JSON.stringify(shots.slice(0, 50)));
  return { uploadId: up.id, call };
}
