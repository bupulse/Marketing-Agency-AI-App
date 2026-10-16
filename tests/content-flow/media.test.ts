import { describe, expect, it } from "vitest";
import { assignMedia, describeItem, hasBeforeAfter, mediaLines, NO_FILE_NAMES, orderPhotos, type GalleryItem, type PostMedia } from "@/lib/content-flow/media";

const NETS = new WeakMap<PostMedia[], string[]>();
function plan(input: Parameters<typeof assignMedia>[0]) {
  const out = assignMedia(input);
  NETS.set(out, [...input.networks]);
  return out;
}
const by = (list: PostMedia[], n: string) => list[NETS.get(list)!.indexOf(n)];

const photo = (n: number, uses = 0, name = `tower ${n}.jpg`): GalleryItem => ({ path: `u1/gallery/p${n}.jpg`, name, mimeType: "image/jpeg", recentUses: uses });
const mp4: GalleryItem = { path: "u1/gallery/v1.mp4", name: "Tower demo in class.mp4", mimeType: "video/mp4" };
const webm: GalleryItem = { path: "u1/gallery/v2.webm", name: "clip.webm", mimeType: "video/webm" };

describe("gallery first", () => {
  it("gives TikTok and YouTube the album's video and Instagram an MP4 video as a Reel", () => {
    const plans = plan({ networks: ["instagram", "facebook", "tiktok", "youtube"], gallery: [photo(1), mp4, photo(2)], day: "2026-10-13", videoInPlan: true });
    expect(by(plans, "tiktok")).toMatchObject({ kind: "gallery-video", video: { path: mp4.path } });
    expect(by(plans, "youtube")).toMatchObject({ kind: "gallery-video", video: { path: mp4.path } });
    expect(by(plans, "instagram")).toMatchObject({ kind: "gallery-video", video: { path: mp4.path } });
    expect(by(plans, "facebook")).toMatchObject({ kind: "image" });
  });

  it("shares several album videos out between the video apps, and never puts a WebM on Instagram", () => {
    const plans = plan({ networks: ["tiktok", "youtube", "instagram"], gallery: [{ ...webm, recentUses: 0 }, { ...mp4, recentUses: 1 }, photo(1)], day: "2026-10-13", videoInPlan: false });
    expect(by(plans, "tiktok")).toMatchObject({ video: { path: webm.path } });
    expect(by(plans, "youtube")).toMatchObject({ video: { path: mp4.path } });
    expect(by(plans, "instagram")).toMatchObject({ kind: "gallery-video", video: { path: mp4.path } });
    const onlyWebm = plan({ networks: ["instagram"], gallery: [webm, photo(1)], day: "2026-10-13", videoInPlan: false });
    expect(by(onlyWebm, "instagram")?.kind).toBe("image");
  });

  it("without an album video: a video made from the photos when the plan has video, else the script reminder", () => {
    expect(plan({ networks: ["tiktok"], gallery: [photo(1)], day: "2026-10-13", videoInPlan: true })[0]?.kind).toBe("render-video");
    expect(plan({ networks: ["tiktok"], gallery: [photo(1)], day: "2026-10-13", videoInPlan: false })[0]?.kind).toBe("script");
    expect(plan({ networks: ["linkedin"], gallery: [], day: "2026-10-13", videoInPlan: true })[0]).toEqual({ kind: "image", photos: [] });
  });

  it("leads with the least used photos, and each post of the day with a different one", () => {
    const gallery = [photo(1, 3), photo(2, 0), photo(3, 1)];
    expect(orderPhotos(gallery, "2026-10-13").map((p) => p.path)).toEqual(["u1/gallery/p2.jpg", "u1/gallery/p3.jpg", "u1/gallery/p1.jpg"]);
    const plans = plan({ networks: ["instagram", "facebook", "linkedin"], gallery, day: "2026-10-13", videoInPlan: false });
    const leads = ["instagram", "facebook", "linkedin"].map((n) => by(plans, n).photos[0].path);
    expect(new Set(leads).size).toBe(3);
  });

  it("gives an app's second post of the day a picture, not the same Reel again", () => {
    const list = plan({ networks: ["instagram", "instagram"], gallery: [mp4, photo(1)], day: "2026-10-13", videoInPlan: false });
    expect(list.map((m) => m.kind)).toEqual(["gallery-video", "image"]);
  });

  it("rotates equally used photos by day, so the same photo does not lead every day", () => {
    const gallery = [photo(1), photo(2), photo(3), photo(4)];
    const leads = new Set(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"].map((d) => orderPhotos(gallery, d)[0].path));
    expect(leads.size).toBeGreaterThan(1);
  });

  it("tells the writer what the post shows in the owner's own words, never the file names", () => {
    expect(describeItem({ name: "IMG_1.jpg", description: "Students watering the tower" })).toBe("Students watering the tower");
    expect(hasBeforeAfter([{ name: "garden before.jpg" }, { name: "x.jpg", description: "The garden after we planted" }])).toBe(true);
    expect(hasBeforeAfter([{ name: "garden before.jpg" }])).toBe(false);
    // A file name is not a description: "dress 1.jpg" ended up in captions as "swipe to see dress 1, dress 2 and dress 3".
    for (const name of ["hydro-tower_in class.jpg", "dress 1.jpg", "IMG_2034.JPG", "WhatsApp Image 2026-10-01.jpeg"]) expect(describeItem({ name })).toBeNull();
    const video = mediaLines({ kind: "gallery-video", video: mp4, photos: [] });
    expect(video[0]).toContain('"a video"');
    expect(video.join(" ")).not.toContain("Tower demo");
    const lines = mediaLines({ kind: "image", photos: [photo(1, 0, "dress 1.jpg"), { ...photo(2), description: "The blue kitenge dress" }] });
    expect(lines[0]).toContain('"a photo", "The blue kitenge dress"');
    expect(lines.join(" ")).not.toMatch(/dress 1|tower 2/);
    expect(lines).toContain(NO_FILE_NAMES);
    expect(mediaLines({ kind: "own", items: [photo(1, 0, "dress 2.jpg")] })).toEqual(['The post shows the owner\'s own media: "a photo".', NO_FILE_NAMES]);
    expect(mediaLines({ kind: "image", photos: [] })[0]).toContain("designed text image");
  });
});
