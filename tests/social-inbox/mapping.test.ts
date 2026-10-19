import { describe, expect, it } from "vitest";
import { isOwn, readComment, readMessage, readPost, readThread, timeOf } from "@/lib/social/inbox/mapping";

describe("reading Instagram and Facebook answers", () => {
  it("reads Graph times and Unix times", () => {
    expect(timeOf("2026-10-19T08:00:00+0000")?.toISOString()).toBe("2026-10-19T08:00:00.000Z");
    expect(timeOf(1_790_000_000)?.getTime()).toBe(1_790_000_000_000);
    expect(timeOf("not a date")).toBeNull();
  });

  it("reads Instagram and Facebook comments the same way", () => {
    expect(readComment({ id: "C1", text: "Price?", timestamp: "2026-10-19T08:00:00+0000", from: { id: "U1", username: "ana" } })).toMatchObject({ id: "C1", text: "Price?", from: { id: "U1", handle: "ana" } });
    expect(readComment({ id: "C2", message: "Open?", created_time: "2026-10-19T08:00:00+0000", from: { id: "F1", name: "Eve" }, parent: { id: "C0" } })).toMatchObject({ text: "Open?", from: { id: "F1", name: "Eve" }, parentId: "C0" });
    expect(readComment({ text: "no id" })).toBeNull();
  });

  it("reads a post's count from comments_count or the nested summary", () => {
    expect(readPost({ id: "M1", comments_count: 4 })).toMatchObject({ count: 4, comments: null });
    const fb = readPost({ id: "P1_1", message: "Sale", comments: { data: [{ id: "c", message: "hi", from: { id: "F" } }], summary: { total_count: 7 } } });
    expect(fb).toMatchObject({ count: 7, caption: "Sale" });
    expect(fb?.comments).toHaveLength(1);
  });

  it("treats nested messages without sender as ids only, and notes attachments", () => {
    expect(readThread({ id: "T1", messages: { data: [{ id: "m1" }] } })?.messages).toBeNull();
    expect(readMessage({ id: "m2", from: { id: "U" }, attachments: { data: [{ type: "image" }] } })?.text).toBe("Sent an attachment");
    expect(readMessage({ id: "m3", from: { id: "U" }, attachments: { data: [{ type: "story_mention" }] } })).toMatchObject({ storyMention: true, text: "Mentioned you in their story" });
  });

  it("knows the account's own comments by id or @handle", () => {
    expect(isOwn({ id: "IG1" }, { externalAccountId: "IG1" })).toBe(true);
    expect(isOwn({ id: "x", handle: "Shop" }, { externalAccountId: "IG1", handle: "@shop" })).toBe(true);
    expect(isOwn({ id: "U1", handle: "ana" }, { externalAccountId: "IG1", handle: "@shop" })).toBe(false);
    expect(isOwn(null, { externalAccountId: "IG1" })).toBe(false);
  });
});
