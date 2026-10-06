import { expect, test } from "@playwright/test";

for (const path of ["/dashboard/projects/new", "/dashboard/projects/x"]) {
  test(`${path} redirects to login when signed out`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}$`));
  });
}
