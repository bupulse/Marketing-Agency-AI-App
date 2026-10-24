import { describe, expect, it } from "vitest";
import { DRAFTS_KEPT, DRAFT_PREFIX, draftKey, freshenUrls, pathOf, pruneDrafts, readDraft, removeDraft, sameSpec, storable, timeAgo, writeDraft, type DraftStorage } from "@/components/editor/draft";
import { DEMO_SPEC } from "@/components/editor/demo-spec";
import { setLook, trimShot } from "@/lib/editor/ops";
import type { Layer, MotionSpec } from "@/lib/video-engine/spec";

class Fake implements DraftStorage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
const broken: DraftStorage = { length: 0, key: () => null, getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };

const clip = (url: string, start = 0): Layer => ({ kind: "video", url, fit: "cover", start, sound: true, x: 0.5, y: 0.5, w: 1, h: 1 });
const reel = (u1: string, u2: string): MotionSpec => ({ ...DEMO_SPEC, scenes: [{ ...DEMO_SPEC.scenes[0], layers: [clip(u1), ...DEMO_SPEC.scenes[0].layers] }, { ...DEMO_SPEC.scenes[1], layers: [clip(u2, 3), ...DEMO_SPEC.scenes[1].layers] }, { ...DEMO_SPEC.scenes[2], layers: [clip(u1, 6)] }] });
const urls = (s: MotionSpec) => s.scenes.flatMap((x) => x.layers.flatMap((l) => (l.kind === "video" ? [l.url] : [])));

describe("keys", () => {
  it("is per reel, and ':demo' for the example", () => {
    expect(draftKey("job1")).toBe("bp-editor-draft:job1");
    expect(draftKey(null)).toBe("bp-editor-draft:demo");
    expect(draftKey(undefined)).toBe("bp-editor-draft:demo");
  });
});

describe("reading and writing", () => {
  it("saves a draft with the time, and reads it back", () => {
    const st = new Fake();
    const edited = setLook(DEMO_SPEC, "warm");
    expect(writeDraft(st, draftKey("a"), edited, 1000)).toBe(true);
    expect(readDraft(st, draftKey("a"))).toEqual({ spec: edited, savedAt: 1000 });
    removeDraft(st, draftKey("a"));
    expect(readDraft(st, draftKey("a"))).toBeNull();
  });
  it("means no draft, never an error, when storage is blocked, full or missing", () => {
    expect(writeDraft(broken, "k", DEMO_SPEC)).toBe(false);
    expect(readDraft(broken, "k")).toBeNull();
    expect(() => removeDraft(broken, "k")).not.toThrow();
    expect(() => pruneDrafts(broken)).not.toThrow();
    expect(writeDraft(null, "k", DEMO_SPEC)).toBe(false);
    expect(readDraft(null, "k")).toBeNull();
  });
  it("ignores a draft that is not a spec", () => {
    const st = new Fake();
    for (const v of ["not json", "{}", JSON.stringify({ spec: { scenes: [] }, savedAt: 1 }), JSON.stringify({ spec: DEMO_SPEC, savedAt: "x" }), JSON.stringify({ spec: { ...DEMO_SPEC, version: 2 }, savedAt: 1 })]) {
      st.setItem("k", v);
      expect(readDraft(st, "k")).toBeNull();
    }
  });
  it("keeps only the 5 newest drafts, and leaves other keys alone", () => {
    const st = new Fake();
    st.setItem("other", "x");
    for (let i = 0; i < 8; i++) writeDraft(st, draftKey(`r${i}`), DEMO_SPEC, 1000 + i);
    const kept = [...st.data.keys()].filter((k) => k.startsWith(DRAFT_PREFIX)).sort();
    expect(kept).toEqual(["r3", "r4", "r5", "r6", "r7"].map(draftKey));
    expect(DRAFTS_KEPT).toBe(5);
    expect(st.getItem("other")).toBe("x");
  });
});

describe("clip links", () => {
  it("are stored without their signature", () => {
    const stored = storable(reel("https://s/x/clips/a.mp4?token=SECRET", "https://s/x/clips/b.mp4?token=SECRET"));
    expect(JSON.stringify(stored)).not.toContain("SECRET");
    expect(urls(stored)).toEqual(["https://s/x/clips/a.mp4", "https://s/x/clips/b.mp4", "https://s/x/clips/a.mp4"]);
    expect(pathOf("https://s/a.mp4")).toBe("https://s/a.mp4");
  });
  it("are replaced on restore by the fresh links of the reel that was opened, matched by path", () => {
    const fresh = reel("https://s/x/clips/a.mp4?token=NEW1", "https://s/x/clips/b.mp4?token=NEW2");
    const stored = storable(setLook(reel("https://s/x/clips/a.mp4?token=OLD", "https://s/x/clips/b.mp4?token=OLD"), "warm"));
    const back = freshenUrls(stored, fresh);
    expect(urls(back)).toEqual(["https://s/x/clips/a.mp4?token=NEW1", "https://s/x/clips/b.mp4?token=NEW2", "https://s/x/clips/a.mp4?token=NEW1"]);
    expect(back.look?.grade).toBe("warm");
  });
  it("never keep a stored link that the reel does not have", () => {
    const fresh = reel("https://s/x/a.mp4?t=1", "https://s/x/b.mp4?t=1");
    const evil = reel("https://evil.example/a.mp4", "https://evil.example/c.mp4");
    const back = urls(freshenUrls(evil, fresh));
    for (const u of back) expect(["https://s/x/a.mp4?t=1", "https://s/x/b.mp4?t=1"]).toContain(u);
    expect(back[0]).toBe("https://s/x/a.mp4?t=1");
    expect(back[1]).toBe("https://s/x/b.mp4?t=1");
  });
  it("leave a spec without clips as it is", () => {
    expect(freshenUrls(DEMO_SPEC, DEMO_SPEC)).toBe(DEMO_SPEC);
    expect(freshenUrls(reel("a", "b"), DEMO_SPEC)).toEqual(reel("a", "b"));
  });
});

describe("comparing and telling the time", () => {
  it("knows the same edit", () => {
    expect(sameSpec(DEMO_SPEC, JSON.parse(JSON.stringify(DEMO_SPEC)))).toBe(true);
    expect(sameSpec(DEMO_SPEC, trimShot(DEMO_SPEC, 0, { seconds: 2 }))).toBe(false);
  });
  it("says how long ago", () => {
    const now = 10_000_000;
    expect(timeAgo(now - 5_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe("3 days ago");
    expect(timeAgo(now + 1000, now)).toBe("just now");
  });
});
