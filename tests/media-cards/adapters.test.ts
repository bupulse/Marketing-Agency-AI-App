import { describe, expect, it } from "vitest";
import { contentPostView, libraryEyebrow, libraryPlayerItem, libraryStatus, libraryVideoCard, postMedia, type ContentPostLike } from "@/components/media-cards/adapters";
import type { LibraryVideo } from "@/lib/video-library/service";

const now = new Date("2026-11-12T10:00:00Z");

const video = (over: Partial<LibraryVideo> = {}): LibraryVideo => ({
  key: "studio:job1",
  id: "job1",
  source: "studio",
  title: "Hydro Tower",
  engine: "motion",
  ratio: "9:16",
  durationMs: 22_000,
  createdAt: "2026-11-10T08:00:00Z",
  videoUrl: "https://example.test/v.mp4",
  downloadUrl: null,
  posterUrl: "https://example.test/p.jpg",
  caption: "Grow greens at home #kigali",
  isNew: false,
  posts: { count: 0, next: null },
  postHref: null,
  ...over,
});

describe("library adapters", () => {
  it("labels the source", () => {
    expect(libraryEyebrow({ source: "studio", engine: "seedance" })).toBe("Video Studio · AI video");
    expect(libraryEyebrow({ source: "studio", engine: "other" })).toBe("Video Studio");
    expect(libraryEyebrow({ source: "upload", engine: "upload" })).toBe("Uploaded");
    expect(libraryEyebrow({ source: "slideshow", engine: null })).toBe("Post video");
  });
  it("gives the status from its posts", () => {
    expect(libraryStatus({ posts: { count: 0, next: null } })).toEqual({ status: "ready", label: "Not posted yet" });
    expect(libraryStatus({ posts: { count: 2, next: null } })).toEqual({ status: "posted", label: "In 2 posts" });
    expect(libraryStatus({ posts: { count: 1, next: "2026-11-13T10:30:00Z" } }).status).toBe("scheduled");
  });
  it("builds the card and player item", () => {
    const card = libraryVideoCard(video({ posts: { count: 1, next: "2026-11-13T10:30:00Z" } }), "Africa/Kigali");
    expect(card.id).toBe("video-job1");
    expect(card.video).toEqual({ src: "https://example.test/v.mp4", poster: "https://example.test/p.jpg", durationMs: 22_000, ratio: "9:16" });
    expect(card.dateLabel).toBe("Made 10 Nov 2026 · next post Fri 13 Nov, 12:30");
    expect(card.note).toBe("Grow greens at home #kigali");
    expect(libraryPlayerItem(video())).toMatchObject({ id: "studio:job1", src: "https://example.test/v.mp4", title: "Hydro Tower", ratio: "9:16" });
  });
});

const post = (over: Partial<ContentPostLike> = {}): ContentPostLike => ({
  id: "p1",
  network: "instagram",
  accountName: "LEAF Example",
  accountAvatar: null,
  notify: false,
  status: "SCHEDULED",
  text: "Fresh greens",
  hashtags: ["kigali"],
  media: [{ path: "a/1.webp", url: "https://example.test/1.webp" }],
  poster: null,
  kind: "post",
  scheduledAt: "2026-11-13T10:30:00Z",
  publishedAt: null,
  title: null,
  link: null,
  ...over,
});

describe("content post adapter", () => {
  it("maps a scheduled picture post", () => {
    const v = contentPostView(post(), "Africa/Kigali", now);
    expect(v).toMatchObject({ id: "p1", platform: "instagram", status: "scheduled", timeLabel: "Tomorrow 12:30", caption: "Fresh greens", hashtags: ["kigali"] });
    expect(v.media).toEqual([{ kind: "image", url: "https://example.test/1.webp" }]);
  });
  it("uses the published time and the reminder status", () => {
    expect(contentPostView(post({ status: "PUBLISHED", publishedAt: "2026-11-12T07:00:00Z" }), "Africa/Kigali", now).timeLabel).toBe("3h");
    expect(contentPostView(post({ notify: true }), "Africa/Kigali", now).status).toBe("reminder");
  });
  it("keeps a video with its still as the poster", () => {
    const media = postMedia({ poster: null, media: [{ path: "a/still.webp", url: "s" }, { path: "a/reel.mp4", url: "v" }] });
    expect(media).toEqual([{ kind: "video", url: "v", poster: "s" }]);
  });
  it("shows a video idea's caption, not its script", () => {
    expect(contentPostView(post({ kind: "video", text: "SCENE 1 ...", excerpt: "Watch this" }), "UTC", now).caption).toBe("Watch this");
  });
});
