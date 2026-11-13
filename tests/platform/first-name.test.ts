import { describe, expect, it } from "vitest";
import { greetingFirstName } from "@/lib/platform/first-name";

// The service chooser greets people by the name saved in Settings, like the dashboard (QA 13 Nov: "Welcome back,
// Bupulse." on /apps, "Welcome back, Euzeb" in Marketing).
describe("greetingFirstName", () => {
  it("prefers the saved name, then the sign-in's names", () => {
    expect(greetingFirstName("Euzeb Cyusa", { full_name: "BuPulse Office" })).toBe("Euzeb");
    expect(greetingFirstName("  ", { full_name: "Aline Uwase" })).toBe("Aline");
    expect(greetingFirstName(null, { ceo_name: "Jean Bosco" })).toBe("Jean");
    expect(greetingFirstName(null, undefined)).toBeNull();
  });
});
