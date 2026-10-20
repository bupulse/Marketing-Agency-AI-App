// "Share to WhatsApp" (docs/guide/features/32-phone-app-and-whatsapp-share.md): no tool can post to WhatsApp Status, so
// the owner shares the picture or video from their phone in one tap. This is the caption and the files for it. Pure,
// so it can be tested and used in the browser.
import { scriptLines } from "@/lib/visuals/video-plan";

/** WhatsApp takes up to 30 files in one share; a post never has more than a carousel's 10. */
export const MAX_SHARED_FILES = 10;

const HASHTAG_LINE = /^(?:\s*#[\p{L}\p{N}_]+[\s,.]*)+$/u;
// Hashtags closing a line: after the sentence ended (or an emoji), or two and more in a row. "in #Kigali." is a word.
const TRAILING_HASHTAGS = /(?:(?<=[.!?…)\]\p{Extended_Pictographic}])(?:\s+#[\p{L}][\p{L}\p{N}_]*)+|(?:\s+#[\p{L}][\p{L}\p{N}_]*){2,})\s*$/u;
const HASHTAG = /(^|[^\p{L}\p{N}_&])#([\p{L}][\p{L}\p{N}_]*)/gu;
// Network-only calls to action that mean nothing in a WhatsApp chat or Status.
const NETWORK_ONLY = /\b(?:link|tap|click|shop|order)[^.!?\n]{0,30}\b(?:in|on)\s+(?:our|my|the)?\s*bio\b|\blink\s?in\s?bio\b/i;

/**
 * The post's words for WhatsApp, the same for every app it was written for: its title and text as they are (price,
 * phone number, place and offer stay word for word), without hashtags, which do nothing on WhatsApp ("#Kigali" keeps
 * its word, hashtags at the end of a line go), and without "link in bio" sentences; the post's link at the end instead.
 */
export function whatsappCaption(post: { title?: string | null; text: string; link?: string | null }): string {
  const lines = post.text
    .split("\n")
    .filter((line) => !HASHTAG_LINE.test(line))
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !NETWORK_ONLY.test(sentence))
        .join(" ")
        .replace(TRAILING_HASHTAGS, "")
        .replace(HASHTAG, "$1$2")
        .replace(/[ \t]{2,}/g, " ")
        .trimEnd(),
    );
  // Lines removed above can leave a run of empty lines: keep one at most.
  const text = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const link = post.link?.trim();
  return [post.title?.trim(), text, link && !text.includes(link) ? link : null].filter(Boolean).join("\n\n");
}

/**
 * A post's caption for WhatsApp. A video post's text is its script: its card's caption (`excerpt`, the content's
 * caption) is shared instead, else the script's spoken lines without timestamps and scene directions.
 */
export function postShareCaption(post: { format: string; title?: string | null; text: string; link?: string | null; excerpt?: string }): string {
  if (post.format !== "SCRIPT") return whatsappCaption(post);
  return whatsappCaption({ text: post.excerpt?.trim() || scriptLines(post.text).join("\n"), link: post.link });
}

/** A WhatsApp link that opens a new message with the text filled in (the person picks the chat or Status). */
export function whatsappTextLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** The file extension of a stored path or signed URL ("a/b.JPG?token=x" -> "jpg"); "" when it has none. */
export function extensionOf(path: string): string {
  const name = path.split(/[?#]/)[0].split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The file's type for sharing: what storage answered, else read from the name (phones refuse a file with no type). */
export function shareFileType(path: string, served?: string | null): string {
  if (served && /^(image|video)\//.test(served)) return served.split(";")[0].trim();
  return TYPES[extensionOf(path)] ?? "application/octet-stream";
}

/** "bupulse-post-2.jpg": a plain name for the shared or downloaded file, numbered when there are several. */
export function shareFileName(path: string, index: number, count: number, what: "post" | "video"): string {
  const ext = extensionOf(path) || (what === "video" ? "mp4" : "jpg");
  return `bupulse-${what}${count > 1 ? `-${index + 1}` : ""}.${ext}`;
}
