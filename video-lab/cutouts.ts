// Video Lab product cut-outs (docs/VIDEO_ENGINE.md, "3D look"): a product photo on a plain background, lifted off it for
// the turntable and "contain" photos (lib/video-engine/cutout.ts, free: no AI). Kept in video-lab/data/cutouts/<id>.png;
// a photo that cannot be cut out keeps its reason in <id>.json, so it is not tried again.
import fs from "node:fs/promises";
import path from "node:path";
import { makeCutout } from "@/lib/video-engine/cutout";
import { photoJpeg } from "./data-source";

const DIR = path.resolve("video-lab/data/cutouts");
const SAFE_ID = /^(?:up-[0-9a-f]{12}|[a-z0-9-]{10,40})$/i;

export type LabCutout = { ok: true; png: Buffer } | { ok: false; reason: string };

/** The cut-out of a photo (a product photo id, or an upload "up-..."), made once and then read from the cache. */
export async function cutoutForPhoto(id: string, businessId?: string): Promise<LabCutout> {
  if (!SAFE_ID.test(id)) return { ok: false, reason: "Unknown photo." };
  const png = path.join(DIR, `${id}.png`);
  const refused = path.join(DIR, `${id}.json`);
  const have = await fs.readFile(png).catch(() => null);
  if (have) return { ok: true, png: have };
  const reason = await fs
    .readFile(refused, "utf8")
    .then((t) => (JSON.parse(t) as { reason?: string }).reason ?? "This photo cannot be cut out.")
    .catch(() => null);
  if (reason) return { ok: false, reason };
  const photo = await photoJpeg(id, 1280, businessId);
  const cut = await makeCutout(photo.bytes);
  await fs.mkdir(DIR, { recursive: true });
  if (!cut.ok) {
    await fs.writeFile(refused, JSON.stringify({ reason: cut.reason }));
    return cut;
  }
  await fs.writeFile(png, cut.png);
  return { ok: true, png: cut.png };
}
