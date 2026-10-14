import { describe, expect, it } from "vitest";
import { changedPieces, isRewritePart, isScriptPost, piecesOf, rewriteParts, samePieces, textNearLimit, timeAgo, versionLabel, versionPreview } from "@/lib/content-flow/versions";
import { AD_HEADLINE_COUNT, cleanHeadlines, exactlyThreeHeadlines } from "@/lib/studio/headlines";

const pieces = { title: null, text: "Fresh greens at school.", hashtags: ["#green"], videoScript: "[Tower] Grow at school.", adHeadlines: ["A", "B", "C"] };

describe("ad headlines", () => {
  it("are exactly three, cleaned: list marks, quotes, repeats and empty ones out, held to 40 characters", () => {
    expect(AD_HEADLINE_COUNT).toBe(3);
    expect(cleanHeadlines(["1. Fresh greens", "- fresh greens", '"Grow at school"', " ", "Lettuce by Friday", "A fourth one"])).toEqual(["Fresh greens", "Grow at school", "Lettuce by Friday"]);
    const long = cleanHeadlines(["A very long headline that goes on and on and on forever"])[0];
    expect(long.length).toBeLessThanOrEqual(40);
    expect(exactlyThreeHeadlines(["One", "Two", "Three", "Four"])).toEqual(["One", "Two", "Three"]);
    expect(exactlyThreeHeadlines(["One", "one", "Two"])).toBeNull();
    expect(exactlyThreeHeadlines([])).toBeNull();
  });
});

describe("post versions", () => {
  it("compare every piece: title, text, hashtags, script and headlines", () => {
    expect(samePieces(pieces, { ...pieces })).toBe(true);
    expect(samePieces(pieces, { ...pieces, text: "Other" })).toBe(false);
    expect(samePieces(pieces, { ...pieces, hashtags: ["#green", "#school"] })).toBe(false);
    expect(samePieces(pieces, { ...pieces, videoScript: "" })).toBe(false);
    expect(samePieces(pieces, { ...pieces, adHeadlines: ["A", "C", "B"] })).toBe(false);
    expect(samePieces(pieces, { ...pieces, title: "Title" })).toBe(false);
  });

  it("take the post's words and its content's script and headlines (none for a hand-made post)", () => {
    expect(piecesOf({ title: null, text: "Hi", hashtags: [] }, { videoScript: "S", adHeadlines: ["A", "B", "C"] })).toEqual({ title: null, text: "Hi", hashtags: [], videoScript: "S", adHeadlines: ["A", "B", "C"] });
    expect(piecesOf({ title: "T", text: "Hi", hashtags: ["#x"] }, null)).toEqual({ title: "T", text: "Hi", hashtags: ["#x"], videoScript: "", adHeadlines: [] });
  });

  it("are named for what made them", () => {
    expect(versionLabel({ kind: "original" })).toBe("First version");
    expect(versionLabel({ kind: "edit" })).toBe("Edited");
    expect(versionLabel({ kind: "regenerate", part: "post" })).toBe("Generated again");
    expect(versionLabel({ kind: "regenerate", part: "caption" })).toBe("New caption");
    expect(versionLabel({ kind: "regenerate", part: "script" })).toBe("New video script");
    expect(versionLabel({ kind: "regenerate", part: "headlines" })).toBe("New ad headlines");
    expect(versionLabel({ kind: "restore" }, 2)).toBe("Restored version 2");
    expect(versionLabel({ kind: "restore" })).toBe("Restored");
  });

  it("preview what they changed: new headlines or a new script, else the text (blank lines folded)", () => {
    expect(changedPieces(pieces, null)).toEqual([]);
    expect(versionPreview({ ...pieces, text: "Line one.\n\nLine two." }, null)).toBe("Line one.\nLine two.");
    const headlines = { ...pieces, adHeadlines: ["X", "Y", "Z"] };
    expect(changedPieces(headlines, pieces)).toEqual(["headlines"]);
    expect(versionPreview(headlines, pieces)).toBe("X · Y · Z");
    const script = { ...pieces, videoScript: "[New] Script." };
    expect(changedPieces(script, pieces)).toEqual(["script"]);
    expect(versionPreview(script, pieces)).toBe("[New] Script.");
    const all = { ...pieces, text: "New caption.", videoScript: "[New] Script.", adHeadlines: ["X", "Y", "Z"] };
    expect(changedPieces(all, pieces)).toEqual(["caption", "script", "headlines"]);
    expect(versionPreview(all, pieces)).toBe("New caption.");
  });

  it("say how long ago in words for the last day, else leave it to the date", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    expect(timeAgo("2026-10-14T09:59:30Z", now)).toBe("Just now");
    expect(timeAgo("2026-10-14T09:48:00Z", now)).toBe("12 min ago");
    expect(timeAgo("2026-10-14T07:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-10-12T07:00:00Z", now)).toBeNull();
  });
});

describe("what Generate again may write", () => {
  const post = { status: "PENDING_APPROVAL", format: "POST", text: "Fresh greens at school.", contest: null };
  const content = { videoScript: "[Tower] Grow at school." };

  it("the whole post, its caption, its script and its headlines, for a post BuPulse wrote that has not gone out", () => {
    expect(rewriteParts(post, content)).toEqual(["post", "caption", "script", "headlines"]);
    for (const status of ["DRAFT", "SCHEDULED", "FAILED", "NEEDS_ACTION"]) expect(rewriteParts({ ...post, status }, content)).toHaveLength(4);
  });

  it("nothing for a post that went out, or one BuPulse did not write", () => {
    for (const status of ["PUBLISHED", "PUBLISHING", "CANCELLED"]) expect(rewriteParts({ ...post, status }, content)).toEqual([]);
    expect(rewriteParts(post, null)).toEqual([]);
  });

  it("a contest keeps its caption (prize and rules are the owner's); a script post's caption is its script", () => {
    expect(rewriteParts({ ...post, contest: {} }, content)).toEqual(["script", "headlines"]);
    const scriptPost = { ...post, format: "SCRIPT", text: "[Tower] Grow at school." };
    expect(isScriptPost(scriptPost, content)).toBe(true);
    expect(isScriptPost({ ...scriptPost, text: "A caption with the video" }, content)).toBe(false);
    expect(rewriteParts(scriptPost, content)).toEqual(["post", "script", "headlines"]);
  });

  it("knows its parts and shows what is left only when it runs low", () => {
    expect(isRewritePart("headlines")).toBe(true);
    expect(isRewritePart("everything")).toBe(false);
    expect(textNearLimit(40, 100)).toBe(false);
    expect(textNearLimit(5, 100)).toBe(true);
    expect(textNearLimit(31, 300)).toBe(false);
    expect(textNearLimit(30, 300)).toBe(true);
    expect(textNearLimit(0, 30)).toBe(true);
  });
});
