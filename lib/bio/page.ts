// The HTML of a link-in-bio page (/b/<slug>). A plain server-rendered page with its CSS inline and one tiny script
// (/bio.js, counts visits and taps): no framework to download, so it opens fast on a slow phone in Instagram's or
// TikTok's own browser. Pure, so the dashboard's live preview draws the very same page in an iframe.
import type { BioView } from "./view";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Content-Security-Policy of the public page: its own images and script only, nothing from elsewhere. */
export function bioPageCsp(nonce: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    `style-src 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export interface BioPageOptions {
  view: BioView;
  /** live: the public page (counts visits and taps). preview: the dashboard's iframe (no script, links open a new tab). */
  mode: "live" | "preview";
  nonce?: string;
  /** The page's own address, for the link preview on WhatsApp and Facebook (og:url). */
  pageUrl?: string;
  /** Absolute address of the picture in the link preview. */
  ogImage?: string | null;
  /** BuPulse's address, for the "Made with BuPulse" corner link (it opens BuPulse's help chat in sales mode). */
  siteUrl: string;
}

// Small inline icons (24 x 24, currentColor): no icon font or extra request.
const ICON = {
  whatsapp:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>',
  pin:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 6v6l4 2"/></svg>',
};

const PULSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M3 12h4l3-7 4 14 3-7h4"/></svg>';

const CSS = `
*{box-sizing:border-box;margin:0}
html{-webkit-text-size-adjust:100%}
body{font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#15161a;background:#f4f5f7}
a{color:inherit}
.wrap{max-width:480px;margin:0 auto;padding:0 16px 88px}
.top{height:88px;background:var(--accent);margin:0 -16px}
.head{display:flex;flex-direction:column;align-items:center;text-align:center;margin-top:-44px;gap:8px}
.logo{width:88px;height:88px;border-radius:50%;background:#fff;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.12);object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:700;color:var(--accent);overflow:hidden}
h1{font-size:23px;line-height:1.2;font-weight:750;letter-spacing:-.01em}
.tag{color:#4d535e;font-size:15.5px;max-width:34ch}
.cta{display:flex;flex-direction:column;gap:10px;margin:20px 0 6px}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;min-height:54px;border-radius:16px;font-weight:700;font-size:17px;text-decoration:none;padding:0 18px}
.btn svg{width:24px;height:24px;flex:none}
.wa{background:#0b7a3e;color:#fff}
.call{background:#fff;color:#15161a;border:1.5px solid #d5d8de}
.btn:focus-visible,.ask:focus-visible,.card a:focus-visible,.links a:focus-visible{outline:3px solid #2f6bff;outline-offset:2px}
.box{background:#fff;border-radius:16px;padding:14px 16px;margin-top:12px;display:flex;gap:12px;align-items:flex-start}
.box>svg{width:22px;height:22px;flex:none;color:var(--accent);margin-top:2px}
.box p{font-size:15px}
.box .muted{color:#5b616c;font-size:14px}
.box a{font-weight:650;font-size:14.5px;display:inline-block;margin-top:4px;text-decoration:underline}
.open{color:#0b7a3e;font-weight:650}
.closed{color:#b42318;font-weight:650}
h2{font-size:17px;font-weight:700;margin:24px 2px 10px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;list-style:none;padding:0}
.item{background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column}
.ph{aspect-ratio:1/1;background:#e9ebef;display:flex;align-items:center;justify-content:center;color:#9aa0aa;font-size:28px;font-weight:700}
.ph img{width:100%;height:100%;object-fit:cover;display:block}
.it{padding:10px 10px 12px;display:flex;flex-direction:column;gap:4px;flex:1}
.it h3{font-size:14.5px;font-weight:650;line-height:1.3}
.price{font-weight:750;font-size:15px}
.sum{color:#5b616c;font-size:13px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ask{margin-top:auto;display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;border-radius:12px;background:#e7f4ec;color:#08592d;font-weight:700;font-size:13.5px;text-decoration:none}
.ask svg{width:18px;height:18px}
.links{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:22px;list-style:none;padding:0}
.links a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:22px;background:#fff;border:1px solid #e1e4e9;text-decoration:none;font-weight:600;font-size:14.5px}
.made{position:fixed;right:16px;bottom:20px;z-index:10;display:inline-flex;align-items:center;gap:8px;padding:8px 12px 8px 8px;border-radius:999px;background:rgba(255,255,255,.92);border:1px solid #dcdce0;box-shadow:0 8px 24px -12px rgba(11,11,15,.35);text-decoration:none;color:#1d1d1f;font-size:13px;font-weight:600}
.made span{width:26px;height:26px;border-radius:50%;background-image:linear-gradient(120deg,#2f6bff,#7b5cff);display:inline-flex;align-items:center;justify-content:center;color:#fff}
.made svg{width:14px;height:14px}
@media (min-width:560px){.grid{grid-template-columns:1fr 1fr 1fr}.wrap{padding-top:16px}.top{border-radius:0 0 24px 24px}}
`;

function head(o: BioPageOptions): string {
  const v = o.view;
  const title = v.tagline ? `${v.name}: ${v.tagline}` : v.name;
  const description = v.tagline ?? `Prices, opening hours and WhatsApp for ${v.name}.`;
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(v.name)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    ...(o.pageUrl ? [`<meta property="og:url" content="${esc(o.pageUrl)}">`, `<link rel="canonical" href="${esc(o.pageUrl)}">`] : []),
    ...(o.ogImage ? [`<meta property="og:image" content="${esc(o.ogImage)}">`] : []),
    `<meta name="twitter:card" content="summary">`,
  ];
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${esc(v.accent)}">
${tags.join("\n")}
${o.mode === "preview" ? '<base target="_blank">' : ""}`;
}

function body(v: BioView): string {
  const parts: string[] = [];
  parts.push(`<div class="top"></div><header class="head">`);
  parts.push(v.logoUrl ? `<img class="logo" src="${esc(v.logoUrl)}" alt="" width="88" height="88">` : `<div class="logo" aria-hidden="true">${esc(v.initial)}</div>`);
  parts.push(`<h1>${esc(v.name)}</h1>`);
  if (v.tagline) parts.push(`<p class="tag">${esc(v.tagline)}</p>`);
  parts.push(`</header>`);

  if (v.whatsapp || v.call) {
    parts.push(`<nav class="cta" aria-label="Contact">`);
    if (v.whatsapp) parts.push(`<a class="btn wa" href="${esc(v.whatsapp.href)}" data-t="wa" rel="noopener">${ICON.whatsapp}Chat on WhatsApp</a>`);
    if (v.call) parts.push(`<a class="btn call" href="${esc(v.call.href)}" data-t="call">${ICON.phone}Call ${esc(v.call.display)}</a>`);
    parts.push(`</nav>`);
  }

  if (v.place) {
    parts.push(`<section class="box" aria-label="Where to find us">${ICON.pin}<div>`);
    parts.push(`<p>${esc(v.place.text)}</p>`);
    if (v.place.landmark) parts.push(`<p class="muted">${esc(v.place.landmark)}</p>`);
    parts.push(`<a href="${esc(v.place.mapsUrl)}" rel="noopener">Open in Google Maps</a></div></section>`);
  }

  if (v.hours && (v.hours.lines.length || v.hours.status)) {
    parts.push(`<section class="box" aria-label="Opening hours">${ICON.clock}<div>`);
    if (v.hours.status) parts.push(`<p class="${v.hours.open ? "open" : "closed"}">${esc(v.hours.status)}</p>`);
    for (const line of v.hours.lines) parts.push(`<p class="muted">${esc(line)}</p>`);
    parts.push(`</div></section>`);
  }

  if (v.items.length) {
    parts.push(`<h2>Products and prices</h2><ul class="grid">`);
    v.items.forEach((item, i) => {
      // The first row loads at once; the rest only when scrolled to, so a slow phone shows the top first.
      const img = item.photoUrl
        ? `<img src="${esc(item.photoUrl)}" alt="${esc(item.name)}" width="480" height="480" decoding="async"${i >= 2 ? ' loading="lazy"' : ""}>`
        : esc((item.name.trim()[0] ?? "").toUpperCase());
      parts.push(`<li class="item"><div class="ph"${item.photoUrl ? "" : ' aria-hidden="true"'}>${img}</div><div class="it">`);
      parts.push(`<h3>${esc(item.name)}</h3><p class="price">${esc(item.price)}</p>`);
      if (item.summary) parts.push(`<p class="sum">${esc(item.summary)}</p>`);
      if (item.askHref) parts.push(`<a class="ask" href="${esc(item.askHref)}" data-t="wa" rel="noopener" aria-label="Ask about ${esc(item.name)} on WhatsApp">${ICON.whatsapp}Ask on WhatsApp</a>`);
      parts.push(`</div></li>`);
    });
    parts.push(`</ul>`);
  }

  if (v.links.length) {
    parts.push(`<ul class="links" aria-label="Find us online">`);
    for (const l of v.links) parts.push(`<li><a href="${esc(l.href)}" rel="noopener">${esc(l.label)}</a></li>`);
    parts.push(`</ul>`);
  }
  return parts.join("\n");
}

/** The full HTML of the page. */
export function renderBioPage(o: BioPageOptions): string {
  const v = o.view;
  const nonce = o.nonce ? ` nonce="${esc(o.nonce)}"` : "";
  // The corner link opens BuPulse's own help chat in sales mode ("want a page like this?"), on a page of its own, so
  // this page keeps its strict CSP and loads nothing more (docs/SUPPORT_CHAT.md "10. Visitor chat").
  const made = `${o.siteUrl.replace(/\/$/, "")}/help-chat?from=bio&utm_source=bio&utm_medium=referral`;
  return `<!doctype html>
<html lang="en">
<head>
${head(o)}
<style${nonce}>:root{--accent:${esc(v.accent)}}${CSS}</style>
</head>
<body>
<main class="wrap">
${body(v)}
</main>
<a class="made" href="${esc(made)}" rel="noopener" aria-label="Made with BuPulse: chat with BuPulse about getting a page like this"><span>${PULSE}</span>Made with BuPulse</a>
${o.mode === "live" ? '<script src="/bio.js" defer></script>' : ""}
</body>
</html>`;
}

/** The answer for an unknown or switched-off page: says nothing about whether a business is behind the address. */
export function bioUnavailablePage(nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found</title><style nonce="${esc(nonce)}">body{font:16px/1.5 system-ui,sans-serif;color:#4d535e;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}</style></head><body><p>This page is not available.</p></body></html>`;
}
