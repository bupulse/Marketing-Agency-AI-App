import { expect, test, type Page } from "@playwright/test";

// These tests stop before "Create account": nothing here calls Supabase sign-up.

async function fillStep1(page: Page, email = "owner@example.com") {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

async function fillStep2(page: Page) {
  await page.getByLabel("Organisation name").fill("Sunrise Phones");
  await page.getByLabel("CEO name").fill("Ana Silva");
  await page.getByLabel("Business sector").selectOption("other");
  await page.getByLabel("Your industry").fill("Phone repairs");
  await page.getByLabel("Describe your business").fill("We repair and sell phones and accessories in Nairobi CBD.");
  await page.getByLabel("Country").selectOption("Kenya");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

test("step 1 validates the email before continuing", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByText("Step 1 of 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("step 2 requires organisation details and validates optional fields", async ({ page }) => {
  await page.goto("/signup");
  await fillStep1(page);
  await expect(page.getByRole("heading", { name: "About your organisation" })).toBeFocused();
  await expect(page.getByText("Step 2 of 3", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Enter your organisation name.")).toBeVisible();
  await expect(page.getByText("Enter the CEO's name.")).toBeVisible();
  await expect(page.getByText("Choose your business sector.")).toBeVisible();
  await expect(page.getByText("Describe your business in a sentence or two.")).toBeVisible();
  await expect(page.getByText("Choose your country.")).toBeVisible();
  await expect(page.getByLabel("Organisation name")).toBeFocused();

  await page.getByLabel("Organisation name").fill("Sunrise Phones");
  await page.getByLabel("CEO name").fill("Ana Silva");
  // "Other" reveals the industry text and moves focus into it.
  await page.getByLabel("Business sector").selectOption("other");
  await expect(page.getByLabel("Your industry")).toBeFocused();
  await page.getByLabel("Describe your business").fill("We repair and sell phones and accessories in Nairobi CBD.");
  await page.getByLabel("Country").selectOption("Kenya");
  await page.getByLabel("Phone (optional)").fill("12");
  await page.getByLabel("Website (optional)").fill("not a url");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Tell us your industry.")).toBeVisible();
  await expect(page.getByText(/Enter a valid Kenyan number/)).toBeVisible();
  await expect(page.getByText("Enter a valid website")).toBeVisible();

  await page.getByLabel("Your industry").fill("Phone repairs");
  // Typing a national number groups it with the Kenyan dial code.
  await page.getByLabel("Phone (optional)").fill("0712345678");
  await expect(page.getByLabel("Phone (optional)")).toHaveValue("+254 712 345 678");
  await page.getByLabel("Website (optional)").fill("sunrise.example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Secure your account" })).toBeVisible();
});

test("back keeps the values that were entered", async ({ page }) => {
  await page.goto("/signup");
  await fillStep1(page, "keep@example.com");
  await fillStep2(page);
  await expect(page.getByText("Step 3 of 3", { exact: true })).toBeVisible();
  await page.locator('input[name="password"]').fill("abc12345");

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Organisation name")).toHaveValue("Sunrise Phones");
  await expect(page.getByLabel("CEO name")).toHaveValue("Ana Silva");
  await expect(page.getByLabel("Business sector")).toHaveValue("other");
  await expect(page.getByLabel("Your industry")).toHaveValue("Phone repairs");
  await expect(page.getByLabel("Country")).toHaveValue("Kenya");

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Email")).toHaveValue("keep@example.com");

  await fillStep1(page, "keep@example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator('input[name="password"]')).toHaveValue("abc12345");
});

test("step 3 shows live password checks and requires matching passwords and consent", async ({ page }) => {
  await page.goto("/signup");
  await fillStep1(page);
  await fillStep2(page);

  const checks = page.getByRole("list", { name: "Password requirements" });
  await expect(checks.getByText("At least 8 characters (not met)")).toBeVisible();
  const password = page.locator('input[name="password"]');

  await password.fill("abcdefgh");
  await expect(checks.getByText("At least 8 characters (met)")).toBeVisible();
  await expect(checks.getByText("At least one letter (met)")).toBeVisible();
  await expect(checks.getByText("At least one number (not met)")).toBeVisible();

  await password.fill("abcdefg1");
  await expect(checks.getByText("At least one number (met)")).toBeVisible();

  await page.locator('input[name="confirmPassword"]').fill("different1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  await expect(page.getByText("Agree to the Terms and Privacy Policy to continue.")).toBeVisible();

  await expect(page.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
});

test("a short password is rejected", async ({ page }) => {
  await page.goto("/signup");
  await fillStep1(page);
  await fillStep2(page);
  await page.locator('input[name="password"]').fill("a1");
  await page.locator('input[name="confirmPassword"]').fill("a1");
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 8 characters with a letter and a number.")).toBeVisible();
});

for (const width of [360, 320]) {
  test(`sign-up steps have no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/signup");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await fillStep1(page);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await fillStep2(page);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}

test("sign-up is reachable from the login page and marketing CTA", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
