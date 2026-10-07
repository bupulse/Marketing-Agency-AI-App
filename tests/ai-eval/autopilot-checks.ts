import type { Network } from "@/lib/social/types";
import { getProvider } from "@/lib/social/registry";
import { factsText, inventedNumbers, knownNumbers, type ImageText, type WriteRequest, type WrittenVersion } from "@/lib/autopilot/writer";
import type { AutopilotFormat } from "@/lib/autopilot/playbook";
import { LANGUAGE_WORDS, withoutScriptNumbers, wordsOf } from "./checks";

const TIMESTAMP = /\d+\s*[-–—]\s*\d+\s*(?:s\b|sec|seconds?|secondes|segundos|sekunde|saa)|\d{1,2}:\d{2}/i;

function similarity(a: string, b: string): number {
  const x = new Set(wordsOf(a));
  const y = new Set(wordsOf(b));
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, Math.min(x.size, y.size));
}

/** Problems with one network's version; an empty list means it passes. */
export function checkVersion(version: WrittenVersion, format: AutopilotFormat, req: WriteRequest): string[] {
  const problems: string[] = [];
  const net: Network = version.network;
  const rules = getProvider(net).rules;
  const language = req.brand.contentLanguage ?? "English";
  const text = version.text;
  const tag = `${net}/${format}`;

  if (!text.trim()) problems.push(`${tag}: empty text`);
  if (text.length > rules.maxText) problems.push(`${tag}: ${text.length} characters, over ${rules.maxText}`);
  if (version.hashtags.some((t) => !/^#\S+$/.test(t))) problems.push(`${tag}: malformed hashtag`);
  if (format !== "SCRIPT" && /#\S/.test(text)) problems.push(`${tag}: text contains hashtags`);
  const known = knownNumbers(factsText(req));
  if (version.hashtags.some((t) => inventedNumbers(t, known).length > 0)) problems.push(`${tag}: hashtag with an invented number`);

  switch (net) {
    case "linkedin":
      if (version.hashtags.length > 3) problems.push("linkedin: more than 3 hashtags");
      if (format === "ARTICLE") {
        if (!version.title) problems.push("linkedin: article without a title");
        if (text.length < 1200) problems.push(`linkedin: article only ${text.length} characters (want long-form)`);
        if (text.split(/\n\s*\n/).length < 3) problems.push("linkedin: article has fewer than 3 sections");
      } else if (text.length < 250) problems.push(`linkedin: post only ${text.length} characters (want a developed, professional post)`);
      break;
    case "instagram":
      if (format === "SCRIPT") {
        if (!TIMESTAMP.test(text)) problems.push("instagram: script without timestamps");
      } else {
        if (version.hashtags.length < 5) problems.push(`instagram: ${version.hashtags.length} hashtags (want 5 or more)`);
        if (version.hashtags.length > 15) problems.push("instagram: too many hashtags");
      }
      break;
    case "facebook":
      if (version.hashtags.length > 3) problems.push("facebook: more than 3 hashtags");
      if (text.length > 1500) problems.push(`facebook: ${text.length} characters (want conversational and short)`);
      break;
    case "tiktok":
    case "youtube":
      if (!TIMESTAMP.test(text)) problems.push(`${net}: script without timestamps`);
      if ((text.match(TIMESTAMP) ?? []).length < 2 && (text.match(/\d+\s*[-–—]\s*\d+/g) ?? []).length < 2) problems.push(`${net}: script has fewer than 2 timed scenes`);
      break;
  }

  // Numbers must come from the facts (script timestamps are format, not facts).
  // "1." and "2)" starting a line are list numbering, not facts.
  const body = (format === "SCRIPT" ? withoutScriptNumbers(text) : text).replace(/^[ \t]*\d{1,2}[.)](?=\s)/gm, " ");
  for (const n of inventedNumbers([body, version.title ?? ""].join("\n"), known)) problems.push(`${tag}: number "${n}" is not in the facts`);

  const rule = LANGUAGE_WORDS[language];
  if (rule) {
    const set = new Set(wordsOf(text));
    const hits = rule.words.filter((w) => set.has(w)).length;
    if (hits < rule.min) problems.push(`${tag}: does not look like ${language} (${hits} common words)`);
  }
  return problems;
}

/** Problems with the versions of one group as a whole: each network must read differently. */
export function checkGroup(versions: WrittenVersion[]): string[] {
  const problems: string[] = [];
  for (let i = 0; i < versions.length; i++) {
    for (let j = i + 1; j < versions.length; j++) {
      if (similarity(versions[i].text, versions[j].text) > 0.85) problems.push(`${versions[i].network} and ${versions[j].network} read almost the same`);
    }
  }
  return problems;
}

export function checkImageText(image: ImageText, req: WriteRequest): string[] {
  const problems: string[] = [];
  if (!image.headline) problems.push("image: no headline");
  if (image.headline.length > 45) problems.push("image: headline too long");
  if (image.subline.length > 70) problems.push("image: subline too long");
  for (const n of inventedNumbers(Object.values(image).join(" "), knownNumbers(factsText(req)))) problems.push(`image: number "${n}" is not in the facts`);
  return problems;
}
