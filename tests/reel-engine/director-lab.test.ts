import { describe, expect, it } from "vitest";
import { BROLL_SHOTS, REEL_CAMERAS, directMontage, directReel } from "@/lib/reel-engine/story";
import { directorIdsIn, labPreferences, type DirectorExample } from "@/lib/training-lab/director";

const example = (over: Partial<DirectorExample> = {}): DirectorExample => ({ technique: [], tags: [], notes: null, rating: 5, neverThis: null, ...over });
const PUSH_IN = REEL_CAMERAS[2];

describe("labPreferences", () => {
  it("maps a best-rated example's techniques, tags and notes to the Director's own shots and moves", () => {
    const taste = labPreferences([example({ technique: ["Spin"], tags: ["question hook"], notes: { shots: ["a slow push-in on the detail"], hook: "she walks up to the camera" } })]);
    expect(new Set(taste.prefer)).toEqual(new Set(["broll:spin", "hook:question", "broll:detail", "hook:walk-up", PUSH_IN]));
    expect(taste.avoid).toEqual([]);
  });

  it("only 4 or 5 stars count as more like this; a never note names what to avoid, and avoid wins", () => {
    expect(labPreferences([example({ rating: 3, technique: ["spin"] }), example({ rating: null, technique: ["spin"] })]).prefer).toEqual([]);
    const taste = labPreferences([example({ technique: ["whip pan", "spin"] }), example({ rating: 1, neverThis: "Never a whip pan, it looks cheap." })]);
    expect(taste.prefer).toEqual(["broll:spin"]);
    expect(taste.avoid).toEqual(["broll:in-place"]);
  });

  it("ignores words it does not know", () => {
    expect(directorIdsIn("a lovely sunset with drums and confetti")).toEqual([]);
    expect(labPreferences([example({ technique: ["beat sync", "3D sticker"] })])).toEqual({ prefer: [], avoid: [] });
  });
});

describe("the Director with the Lab's taste", () => {
  const seeds = ["job-1", "job-2", "abc", "z"];

  it("makes exactly the same plan without a taste, or with an empty one", () => {
    for (const seed of seeds) {
      expect(directMontage([], seed, {})).toEqual(directMontage([], seed));
      expect(directMontage([], seed, { prefer: [], avoid: [] })).toEqual(directMontage([], seed));
      expect(directReel([{ variant: "hook:reveal", camera: REEL_CAMERAS[0] }], seed, {})).toEqual(directReel([{ variant: "hook:reveal", camera: REEL_CAMERAS[0] }], seed));
    }
  });

  it("breaks a tie on least used towards what the owner prefers", () => {
    for (const seed of seeds) {
      const plan = directMontage([], seed, { prefer: ["hook:question", "broll:result", PUSH_IN] });
      expect(plan[0].variant).toBe("hook:question");
      expect(plan.map((c) => c.variant)).toContain("broll:result");
      expect(plan[0].camera).toBe(PUSH_IN);
    }
  });

  it("still picks what the company had least before a preference", () => {
    const recent = [{ variant: "hook:question", camera: PUSH_IN }];
    for (const seed of seeds) {
      const plan = directMontage(recent, seed, { prefer: ["hook:question", PUSH_IN] });
      expect(plan[0].variant).not.toBe("hook:question");
      expect(plan.map((c) => c.camera)).not.toContain(PUSH_IN);
    }
  });

  it("never picks what the owner marked never while something else is left", () => {
    for (const seed of seeds) {
      const plan = directMontage([], seed, { avoid: ["broll:spin", "hook:walk-up", REEL_CAMERAS[0]] });
      expect(plan.map((c) => c.variant)).not.toContain("broll:spin");
      expect(plan[0].variant).not.toBe("hook:walk-up");
      expect(plan.map((c) => c.camera)).not.toContain(REEL_CAMERAS[0]);
    }
  });

  it("picks an avoided one only when nothing else is left", () => {
    const allHooks = ["hook:walk-up", "hook:struggle", "hook:question", "hook:reveal"];
    expect(allHooks).toContain(directMontage([], "job-1", { avoid: allHooks })[0].variant);
    const twoShots = BROLL_SHOTS.slice(0, 2).map((b) => `broll:${b.id}`);
    const shots = directMontage([], "job-1", { avoid: [...twoShots, `broll:${BROLL_SHOTS[2].id}`] }).filter((c) => c.kind === "broll").map((c) => c.variant);
    // Four shots are always made; only 2 were free, so 2 avoided ones fill in after them.
    expect(shots).toHaveLength(4);
    expect(shots.filter((v) => !twoShots.includes(v) && v !== `broll:${BROLL_SHOTS[2].id}`)).toHaveLength(2);
  });
});
