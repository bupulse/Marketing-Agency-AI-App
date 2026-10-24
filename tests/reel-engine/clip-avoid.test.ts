import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { clipAvoid } = await import("@/lib/reel-engine/engine");

const row = (kind: string, neverThis: string | null) => ({ kind, neverThis });

describe("the never notes the clip checker uses", () => {
  it("come only from reel and video examples, never from a recording", () => {
    expect(clipAvoid([row("reel", "The presenter walks through the product."), row("video", "A crowd in the background."), row("voice", "Never the phrase ndabarahiye."), row("image", "Blurry product.")])).toEqual([
      "The presenter walks through the product.",
      "A crowd in the background.",
    ]);
  });

  it("leave out notes about the words, the price, captions, music or sound (the checker only watches)", () => {
    expect(clipAvoid([
      row("reel", "Never say the price out loud."),
      row("reel", "No English words in the captions."),
      row("video", "The music is too loud."),
      row("reel", "Never mention igiciro."),
      row("reel", "Hands melting into the leaves."),
    ])).toEqual(["Hands melting into the leaves."]);
  });

  it("carry no other business's phone number or link", () => {
    expect(clipAvoid([row("reel", "A sign with 0788 300 400 and www.shop.rw in the frame.")])).toEqual(["A sign with {phone} and {website} in the frame."]);
  });

  it("are tidy, without repeats or empty notes, and at most 6", () => {
    const many = Array.from({ length: 9 }, (_, i) => row("reel", `Shot ${i}  is   shaky.`));
    expect(clipAvoid([row("reel", "  "), row("reel", null), row("reel", "Shot 0 is shaky."), ...many])).toEqual(["Shot 0 is shaky.", "Shot 1 is shaky.", "Shot 2 is shaky.", "Shot 3 is shaky.", "Shot 4 is shaky.", "Shot 5 is shaky."]);
    expect(clipAvoid([])).toEqual([]);
  });
});
