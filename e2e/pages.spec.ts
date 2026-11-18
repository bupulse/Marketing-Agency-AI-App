import { expect, test } from "@playwright/test";

const pages = ["/pricing", "/done-for-you", "/industries", "/about", "/contact", "/privacy", "/terms", "/data-deletion", "/blog"];

for (const path of pages) {
  test(`${path} loads with a heading`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
}

test("pricing shows both plan prices", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByText("$49", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$99", { exact: true }).first()).toBeVisible();
});

// CI runs with a placeholder DATABASE_URL and no database (.github/workflows/ci.yml).
const noDatabase = (process.env.DATABASE_URL ?? "").includes("/placeholder");

test("contact form has its labelled fields", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("textbox", { name: "Your name" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
});

test("contact form shows validation errors on empty submit", async ({ page }) => {
  // The server action counts every submit against the public rate limit (a database row) before it validates
  // (lib/contact.ts, by design), so without a database the action fails before any field error comes back.
  test.skip(noDatabase, "needs a database: the contact rate limit runs before validation");
  await page.goto("/contact");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Please tell us your name.")).toBeVisible();
  await expect(page.getByText("Please enter your email.")).toBeVisible();
});

test("blog lists 3 posts and opens one", async ({ page }) => {
  await page.goto("/blog");
  await expect(page.getByRole("article")).toHaveCount(3);
  await page.getByRole("link", { name: /What to post when you have nothing to post/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /nothing to post/ })).toBeVisible();
});

test("unknown blog post is a 404", async ({ page }) => {
  const response = await page.goto("/blog/does-not-exist");
  expect(response?.status()).toBe(404);
});
