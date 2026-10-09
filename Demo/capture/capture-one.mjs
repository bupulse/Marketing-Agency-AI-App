// Re-takes single pages. Usage: node capture-one.mjs <slug> <path> <name> [full]
import { go, launch, login, newContext, shot } from "./lib.mjs";
const [slug, url, name, full] = process.argv.slice(2);
const browser = await launch();
const ctx = await newContext(browser);
const page = await login(ctx, slug);
await go(page, url, 2000);
await shot(page, slug, name);
if (full) await shot(page, slug, name, { fullPage: true });
await browser.close();
