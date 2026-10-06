import { expect, test } from "@playwright/test";

test("pricing toggle switches between monthly and yearly prices", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByText("$49", { exact: true })).toBeVisible();
  await expect(page.getByText("$99", { exact: true })).toBeVisible();

  await page.getByRole("radio", { name: /Yearly/ }).click();
  await expect(page.getByText("$490", { exact: true })).toBeVisible();
  await expect(page.getByText("$990", { exact: true })).toBeVisible();
  await expect(page.getByText("$49", { exact: true })).toHaveCount(0);

  await page.getByRole("radio", { name: "Monthly" }).click();
  await expect(page.getByText("$49", { exact: true })).toBeVisible();
});

test("refund policy page renders and is linked from the footer", async ({ page }) => {
  await page.goto("/refund-policy");
  await expect(page.getByRole("heading", { level: 1, name: "Refund Policy" })).toBeVisible();
  await expect(page.getByText("14-day money-back guarantee")).toBeVisible();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Refund policy" })).toBeVisible();
});
