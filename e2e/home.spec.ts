import { expect, test } from "@playwright/test";

test("homepage loads with a single H1", async ({ page }) => {
  await page.goto("/");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible();
  await expect(h1).toContainText("Your business, marketed every day.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

// Outside the Rwanda price region (CI has no visitor country) the main call to action is the free trial
// (lib/quote/cta.ts); Rwanda visitors get "Get a free quote" instead.
test("Start your free trial goes to sign-up", async ({ page }) => {
  await page.goto("/");
  const cta = page.getByRole("main").getByRole("link", { name: "Start your free trial" }).first();
  await expect(cta).toHaveAttribute("href", "/signup");
  await cta.click();
  await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 });
});

test("FAQ opens", async ({ page }) => {
  await page.goto("/");
  // The first question starts open; "How do I get started?" starts closed. Its answer (trial mode) names the
  // trial length from an Admin setting, so only the fixed opening words are checked.
  const q = page.getByRole("button", { name: "How do I get started?" });
  const answer = page.getByRole("region", { name: "How do I get started?" });
  await expect(q).toHaveAttribute("aria-expanded", "false");
  await expect(answer).toBeHidden();
  await q.click();
  await expect(q).toHaveAttribute("aria-expanded", "true");
  await expect(answer).toBeVisible();
  await expect(answer).toContainText("Sign up, tell BuPulse about your business");
});

test("theme toggle switches the dark class", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: /toggle light and dark theme/i }).click();
  await expect(html).toHaveClass(/dark/);
});

test("no horizontal overflow at 375px and the mobile menu works", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const menu = page.getByRole("button", { name: "Open menu" });
  await menu.click();
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" })).toBeVisible();
});
