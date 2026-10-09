// Renders the three fictional demo logos to PNG (512x512, transparent) with Playwright.
import path from "node:path";
import { chromium } from "@playwright/test";
import { ROOT } from "./db.mjs";

const OUT = path.join(ROOT, "Demo/capture/assets/logos");
const font = "font-family: 'Avenir Next', 'Helvetica Neue', Arial, sans-serif;";
const LOGOS = {
  inzu: `<div style="width:512px;height:512px;border-radius:50%;background:#C2502E;display:flex;flex-direction:column;align-items:center;justify-content:center;${font}">
      <svg width="170" height="120" viewBox="0 0 170 120"><path d="M10 110 L85 20 L160 110" fill="none" stroke="#E0A526" stroke-width="14" stroke-linejoin="round"/><path d="M45 110 L85 62 L125 110" fill="none" stroke="#FFF4E0" stroke-width="10" stroke-linejoin="round"/></svg>
      <div style="color:#FFF4E0;font-size:92px;font-weight:700;letter-spacing:6px;margin-top:6px">INZU</div>
      <div style="color:#E0A526;font-size:34px;font-weight:600;letter-spacing:14px;margin-top:-4px">FASHION</div></div>`,
  urugo: `<div style="width:512px;height:512px;border-radius:96px;background:#1F6F54;display:flex;flex-direction:column;align-items:center;justify-content:center;${font}">
      <svg width="200" height="150" viewBox="0 0 200 150"><path d="M20 80 L100 15 L180 80" fill="none" stroke="#D9C3A0" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><rect x="50" y="78" width="100" height="62" rx="6" fill="none" stroke="#D9C3A0" stroke-width="12"/><rect x="88" y="100" width="24" height="40" fill="#D9C3A0"/></svg>
      <div style="color:#FFFFFF;font-size:88px;font-weight:700;letter-spacing:4px;margin-top:4px">URUGO</div>
      <div style="color:#D9C3A0;font-size:34px;font-weight:600;letter-spacing:16px">HOMES</div></div>`,
  nova: `<div style="width:512px;height:512px;border-radius:120px;background:#0B0B0F;display:flex;flex-direction:column;align-items:center;justify-content:center;${font}">
      <svg width="150" height="190" viewBox="0 0 150 190"><rect x="20" y="8" width="110" height="174" rx="22" fill="none" stroke="#0A84FF" stroke-width="12"/><path d="M75 52 L84 82 L114 92 L84 102 L75 132 L66 102 L36 92 L66 82 Z" fill="#FFFFFF"/></svg>
      <div style="color:#FFFFFF;font-size:96px;font-weight:800;letter-spacing:6px;margin-top:10px">NOVA</div>
      <div style="color:#0A84FF;font-size:32px;font-weight:700;letter-spacing:12px">PHONES</div></div>`,
};

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
for (const [name, html] of Object.entries(LOGOS)) {
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
}
await browser.close();
console.log("logos done");
