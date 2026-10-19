// The studio's reference ids as files for Seedance (video-lab/seedance-references.ts makes them fit BytePlus). The ids
// the Create page sends: ph:<asset> a product photo, up:<upload> an uploaded or AI image (presenter shots too),
// co:<asset> a product photo's cut-out (transparent PNG), pp:<influencer> a presenter's portrait, asset:<id> a ModelArk
// digital character, um:<media> an uploaded video or audio file, vid:<engine>:<job> a finished video of the studio.
import { cutoutForPhoto } from "./cutouts";
import { mediaBytes, photoJpeg } from "./data-source";
import { portraitBytes } from "./influencers";
import type { ReferenceSource } from "./seedance-references";
import { seedanceVideoBytes } from "./seedance-jobs";
import { readVideo } from "./store";

export type StudioRef = { id: string; kind: string; role?: string; label?: unknown };

/** Image roles the page may set; anything else is a reference image. */
const imageRole = (r: StudioRef) => (r.role === "first_frame" || r.role === "last_frame" ? r.role : "reference_image");
const labelOf = (r: StudioRef, fallback: string) => (typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 120) : fallback);
/** The photo size read before fitting: large enough for the 2048 px BytePlus copy. */
const SOURCE_PX = 2048;

/**
 * What a client's request may use (docs/STUDIO_DEPLOY.md, item 3): product photos and cut-outs only of their business,
 * a finished studio video only when it is theirs, and no uploads (up:, um:) until those live in their Gallery. The owner
 * passes nothing and may use everything.
 */
export type ReferenceScope = { videoOwned: (engine: string, jobId: string) => Promise<boolean> };

/** Loads each reference, in the page's order. A missing one is skipped and named in `problems`. */
export async function loadReferenceSources(refs: StudioRef[], businessId: string, scope?: ReferenceScope): Promise<{ sources: ReferenceSource[]; problems: string[] }> {
  const sources: ReferenceSource[] = [];
  const problems: string[] = [];
  for (const r of refs.slice(0, 15)) {
    const [prefix, a, b] = r.id.split(":");
    const missing = (what: string) => problems.push(`${labelOf(r, what)}: not found, left out.`);
    try {
      if (scope && (prefix === "up" || prefix === "um" || (prefix === "vid" && !(await scope.videoOwned(a, b))))) {
        missing("A reference");
        continue;
      }
      if (prefix === "ph" || prefix === "up") {
        const photo = await photoJpeg(a, SOURCE_PX, prefix === "ph" ? businessId : undefined);
        sources.push({ kind: "image", type: "photo", bytes: photo.bytes, label: labelOf(r, "the product photo"), role: imageRole(r) });
      } else if (prefix === "co") {
        const cut = await cutoutForPhoto(a, businessId || undefined);
        if (!cut.ok) {
          problems.push(`${labelOf(r, "The cut-out")}: ${cut.reason} Left out.`);
          continue;
        }
        sources.push({ kind: "image", type: "cutout", bytes: cut.png, label: labelOf(r, "the product cut out on a transparent background"), role: imageRole(r) });
      } else if (prefix === "pp") {
        const bytes = await portraitBytes(a);
        if (!bytes) {
          missing("The presenter portrait");
          continue;
        }
        sources.push({ kind: "image", type: "portrait", bytes, label: labelOf(r, "the presenter's portrait"), role: imageRole(r) });
      } else if (prefix === "asset") {
        sources.push({ kind: "image", type: "asset", asset: r.id.slice("asset:".length), label: labelOf(r, "the digital character"), role: imageRole(r) });
      } else if (prefix === "um") {
        const m = await mediaBytes(a);
        if (!m) {
          missing("The uploaded file");
          continue;
        }
        if (m.mimeType.startsWith("video/")) sources.push({ kind: "video", bytes: m.bytes, label: labelOf(r, "the uploaded video"), publicPath: `/api/media/${a}` });
        else sources.push({ kind: "audio", bytes: m.bytes, mimeType: m.mimeType, label: labelOf(r, "the uploaded audio") });
      } else if (prefix === "vid") {
        const bytes = a === "seedance" ? await seedanceVideoBytes(b) : await readVideo(b);
        if (!bytes) {
          missing("The video");
          continue;
        }
        sources.push({ kind: "video", bytes, label: labelOf(r, "the video"), publicPath: a === "seedance" ? `/videos/seedance/${b}.mp4` : `/videos/${b}.mp4` });
      } else {
        problems.push(`Unknown reference "${r.id}", left out.`);
      }
    } catch {
      missing("A reference");
    }
  }
  return { sources, problems };
}
