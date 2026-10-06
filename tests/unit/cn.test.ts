import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("joins and skips falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
  it("resolves Tailwind conflicts with last-wins", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
  it("supports conditional objects", () => {
    expect(cn("x", { y: true, z: false })).toBe("x y");
  });
});
