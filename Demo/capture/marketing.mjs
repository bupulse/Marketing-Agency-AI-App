// Marketing site captures (signed out).
import { go, hidePlaceholders, launch, newContext, revealAll, shot } from "./lib.mjs";

const browser = await launch();
for (const mobile of [false, true]) {
  const ctx = await newContext(browser, { mobile, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const m = { mobile };

  await go(page, "/", 1500);
  await hidePlaceholders(page);
  await shot(page, "marketing", "home-hero", m);
  await revealAll(page);
  await shot(page, "marketing", "home", { ...m, fullPage: true });
  if (!mobile) {
    const features = page.locator("section#features");
    if (await features.count()) {
      await features.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -40));
      await shot(page, "marketing", "home-features");
      const box = await features.boundingBox();
      if (box) await shot(page, "marketing", "home-features-section", { fullPage: true, clip: { x: 0, y: box.y + (await page.evaluate(() => window.scrollY)), width: 1440, height: box.height } });
    } else console.log("features section not found");
  }

  await go(page, "/pricing", 1500);
  await shot(page, "marketing", "pricing", m);
  await revealAll(page);
  await shot(page, "marketing", "pricing", { ...m, fullPage: true });

  await go(page, "/signup", 1000);
  await shot(page, "marketing", "signup", m);
  await go(page, "/login", 1000);
  await shot(page, "marketing", "signin", m);
  await ctx.close();
}
await browser.close();
