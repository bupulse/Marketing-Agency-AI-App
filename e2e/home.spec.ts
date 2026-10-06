import { expect, test } from "@playwright/test";

test("homepage loads with a single H1", async ({ page }) => {
  await page.goto("/");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible();
  await expect(h1).toContainText("The marketing team for your");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("Start free trial goes to sign-up", async ({ page }) => {
  await page.goto("/");
  const cta = page.getByRole("main").getByRole("link", { name: "Start free trial" }).first();
  await expect(cta).toHaveAttribute("href", "/signup");
  await cta.click();
  await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 });
});

test("FAQ opens", async ({ page }) => {
  await page.goto("/");
  const q = page.getByRole("button", { name: "How does the free trial work?" });
  await expect(q).toHaveAttribute("aria-expanded", "false");
  await q.click();
  await expect(q).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Sign up and use BuPulse free for 7 days")).toBeVisible();
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
