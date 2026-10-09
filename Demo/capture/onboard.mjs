// Signs in each demo account and completes the real /onboarding wizard through the UI.
// The "onboard" account is captured step by step for the video (slug "onboarding").
// Usage: node onboard.mjs inzu urugo nova onboard
import path from "node:path";
import { ACCOUNTS } from "./accounts.mjs";
import { ASSETS, go, launch, login, newContext, settle, shot } from "./lib.mjs";

const slugs = process.argv.slice(2);
const browser = await launch();

for (const slug of slugs) {
  const capture = slug === "onboard";
  const a = capture ? { ...ACCOUNTS.inzu, ...ACCOUNTS.onboard } : ACCOUNTS[slug];
  const logo = path.join(ASSETS, "logos", `${capture ? "inzu" : slug}.png`);
  for (const mobile of [false]) {
    const ctx = await newContext(browser, { mobile });
    const page = await login(ctx, slug);
    await go(page, "/onboarding");
    if (!page.url().includes("/onboarding")) { console.log(slug, "already onboarded:", page.url()); await ctx.close(); continue; }
    const m = { mobile };
    const step = async (n) => capture && shot(page, "onboarding", `step-${n}`, m);

    // 1. What you sell
    await step("1-offer-empty");
    await page.fill('form [name="description"]', a.offer.description);
    await page.fill('form [name="audience"]', a.offer.audience);
    await step("1-offer");
    await page.click('button[type="submit"]');
    // 2. Brand voice
    await page.getByRole("radiogroup", { name: "Brand voice" }).waitFor();
    await settle(page);
    const voice = page.getByRole("radio").filter({ hasText: new RegExp(a.tone, "i") }).first();
    await voice.click();
    await step("2-voice");
    await page.click('button[type="submit"]');
    // 3. Logo and colours
    await page.getByText("Brand colours").waitFor();
    await settle(page);
    await step("3-look-empty");
    await page.setInputFiles('input[type="file"]', logo);
    await page.getByText(/Logo added/).waitFor({ timeout: 60_000 });
    await settle(page, 1000);
    if (capture) await shot(page, "onboarding", "step-3-look-extracted", m);
    // Set the exact brand colours.
    const hex = page.locator('input[aria-label$="hex code"]');
    while ((await hex.count()) > a.colors.length) await page.getByRole("button", { name: `Remove colour ${await hex.count()}` }).click();
    while ((await hex.count()) < a.colors.length) await page.getByRole("button", { name: "Add a colour" }).click();
    for (let i = 0; i < a.colors.length; i++) await hex.nth(i).fill(a.colors[i]);
    await settle(page);
    await step("3-look");
    await page.click('button[type="submit"]');
    // 4. Chat knowledge
    await page.locator('[name="hours"]').waitFor();
    await settle(page);
    await step("4-chat-empty");
    await page.fill('[name="hours"]', a.knowledge.hours);
    await page.fill('[name="area"]', a.knowledge.area);
    await page.fill('[name="contact"]', a.knowledge.contact);
    for (let i = 0; i < a.knowledge.faqs.length; i++) {
      if ((await page.locator(`[name="faqs.${i}.question"]`).count()) === 0) await page.getByRole("button", { name: /add (a )?question/i }).click();
      await page.fill(`[name="faqs.${i}.question"]`, a.knowledge.faqs[i].question);
      await page.fill(`[name="faqs.${i}.answer"]`, a.knowledge.faqs[i].answer);
    }
    await step("4-chat");
    {
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 60_000 }), page.click('button[type="submit"]')]);
      await settle(page, 1500);
      if (capture) await shot(page, "onboarding", "done-dashboard", m);
      console.log(slug, "onboarded ->", page.url());
    }
    await ctx.close();
  }
}
await browser.close();
