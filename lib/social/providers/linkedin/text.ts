// LinkedIn post commentary uses the "little" text format: these characters are reserved and a raw one can
// truncate or reject the post, so each is escaped with a backslash. Hashtags use the hashtag template so they
// stay clickable. https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
const RESERVED = /[\\|{}@[\]()<>#*_~]/g;
const HASHTAG = /#([\p{L}\p{N}_]+)/gu;

/** `hashtags: false` escapes everything as plain text (for URLs). */
export function escapeLittleText(text: string, { hashtags = true } = {}): string {
  if (!hashtags) return text.replace(RESERVED, "\\$&");
  let out = "";
  let last = 0;
  for (const match of text.matchAll(HASHTAG)) {
    out += text.slice(last, match.index).replace(RESERVED, "\\$&");
    out += `{hashtag|\\#|${match[1]}}`;
    last = match.index + match[0].length;
  }
  return out + text.slice(last).replace(RESERVED, "\\$&");
}
