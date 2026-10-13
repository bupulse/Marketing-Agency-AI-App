import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shownError } from "@/components/auth/use-field-errors";

describe("auth forms: a field's error goes away once it is edited", () => {
  it("shows the server's error until the person types in that field", () => {
    const errors = { email: "Enter a valid email address.", password: "Enter a password." };
    expect(shownError(errors, new Set(), "email")).toBe("Enter a valid email address.");
    expect(shownError(errors, new Set(["email"]), "email")).toBeUndefined();
    expect(shownError(errors, new Set(["email"]), "password")).toBe("Enter a password.");
    expect(shownError(undefined, new Set(), "email")).toBeUndefined();
    expect(shownError({ email: "" }, new Set(), "email")).toBeUndefined();
  });

  it("sign-in, forgot-password and reset-password forms clear errors on input; sign-up clears them as it sets values", () => {
    for (const file of ["app/login/LoginForm.tsx", "components/auth/forgot-form.tsx", "components/auth/reset-form.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toContain("onInput={fields.edit}");
      expect(src, file).not.toMatch(/error=\{state\.(fieldErrors|error)/);
    }
    expect(readFileSync("components/auth/signup-form.tsx", "utf8")).toContain('if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));');
  });
});
