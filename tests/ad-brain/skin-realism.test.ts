import { describe, expect, it } from "vitest";
import { CHARACTER_GUIDE, hasFakeSkinWords, hasSlopWords, REAL_PERSON_PHOTO, REAL_PHONE_VIDEO, realistic } from "@/lib/ad-brain/realism";

// Skin reads as real from light, not texture (13 Nov 2026, the Higgsfield comparison): no pores, blemishes or grain
// asked for; a soft side light, a warm lamp, natural sheen and warm undertones instead.

describe("skin from light, not texture", () => {
  it("the person photo prompt never asks for pores, blemishes or grain", () => {
    expect(hasFakeSkinWords(REAL_PERSON_PHOTO)).toBe(false);
    expect(REAL_PERSON_PHOTO).not.toMatch(/pores|blemish|grain|available light only/i);
  });

  it("the person photo prompt lights the face from one side, with sheen and warm undertones", () => {
    expect(REAL_PERSON_PHOTO).toMatch(/window to one side/i);
    expect(REAL_PERSON_PHOTO).toMatch(/gentle shadow/i);
    expect(REAL_PERSON_PHOTO).toMatch(/warm lamp/i);
    expect(REAL_PERSON_PHOTO).toMatch(/sheen on the forehead, nose and cheekbones/i);
    expect(REAL_PERSON_PHOTO).toMatch(/warm red-brown undertones/i);
    // Still not the airbrushed stock look.
    expect(REAL_PERSON_PHOTO).toMatch(/no beauty filter/i);
    expect(REAL_PERSON_PHOTO).toMatch(/no plastic or waxy skin/i);
  });

  it("the phone video prompt and the character guide use side light, not 'available light'", () => {
    expect(REAL_PHONE_VIDEO).not.toMatch(/available light|grain/i);
    expect(REAL_PHONE_VIDEO).toMatch(/window light from one side/i);
    expect(CHARACTER_GUIDE.join(" ")).toMatch(/one side of the face/i);
    expect(hasFakeSkinWords(CHARACTER_GUIDE.join(" "))).toBe(false);
  });

  it("cleans pores, blemishes and grain out of what the brain writes", () => {
    const cleaned = realistic("Woman in her 30s with visible pores, tiny blemishes, uneven skin tone, sensor grain, red headwrap, in her salon");
    expect(hasFakeSkinWords(cleaned)).toBe(false);
    expect(hasSlopWords(cleaned)).toBe(false);
    expect(cleaned).toMatch(/^Woman in her 30s/);
    expect(cleaned).toMatch(/red headwrap, in her salon$/);
    expect(cleaned).not.toMatch(/,\s*,/);
  });

  it("keeps grain the food and noisy the street", () => {
    const scene = "He stacks sacks of grain in a noisy Nyabugogo shop";
    expect(realistic(scene)).toBe(scene);
    expect(hasFakeSkinWords(scene)).toBe(false);
  });

  it("lets lighting words through, but still removes the airbrushed look", () => {
    expect(realistic("soft studio lighting from the left, a ring light on the desk")).toBe("soft studio lighting from the left, a ring light on the desk");
    expect(hasSlopWords("flawless airbrushed skin")).toBe(true);
    expect(realistic("flawless, airbrushed skin, smiling")).toBe("skin, smiling");
  });
});
