import type { PublicWidget } from "./config";
import { frameAncestors } from "./origin";
import { RTL_LANGUAGES, widgetStrings } from "./strings";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON that is safe inside a <script type="application/json"> block. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** CSP of the chat page: framing limited to the business's sites, nothing else loads. */
export function chatPageCsp(
  widget: Pick<PublicWidget, "allowedDomains">,
  nonce: string,
  opts: { turnstile: boolean; imgOrigin?: string | null; ownHosts?: string[]; localFile?: boolean },
): string {
  return [
    "default-src 'none'",
    `script-src 'self'${opts.turnstile ? " https://challenges.cloudflare.com" : ""}`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    `img-src 'self' data:${opts.imgOrigin ? ` ${opts.imgOrigin}` : ""}`,
    opts.turnstile ? "frame-src https://challenges.cloudflare.com" : "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // A file:// page can't be named in frame-ancestors, so local file tests (checked by the caller) go without it.
    ...(opts.localFile ? [] : [frameAncestors(widget.allowedDomains, opts.ownHosts)]),
  ].join("; ");
}

export interface ChatPageOptions {
  widget: PublicWidget;
  nonce: string;
  logoUrl: string | null;
  turnstileSiteKey: string | null;
  mode: "embed" | "preview" | "page";
  origin: string;
  page: string;
}

const CSS = `
*{box-sizing:border-box;margin:0}
html,body{height:100%;background:#fff}
body{font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#15161a;-webkit-text-size-adjust:100%;overflow:hidden}
button,input,textarea{font:inherit;color:inherit}
.panel{display:flex;flex-direction:column;height:100%;height:100dvh;background:#fff}
.head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--accent);color:var(--accent-text);flex:none}
.logo{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.25);object-fit:cover;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none;overflow:hidden}
.title{flex:1;min-width:0;font-weight:650;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.x{border:0;background:transparent;color:inherit;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center}
.x:hover{background:rgba(127,127,127,.25)}
.log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f6f7f9;-webkit-overflow-scrolling:touch}
.msg{max-width:84%;padding:9px 13px;border-radius:16px;white-space:pre-wrap;overflow-wrap:anywhere;animation:in .18s ease-out}
.msg.assistant{align-self:flex-start;background:#fff;border:1px solid #e6e8ec;border-bottom-left-radius:5px}
.msg.visitor{align-self:flex-end;background:var(--accent);color:var(--accent-text);border-bottom-right-radius:5px}
[dir=rtl] .msg.assistant{border-bottom-left-radius:16px;border-bottom-right-radius:5px}
[dir=rtl] .msg.visitor{border-bottom-right-radius:16px;border-bottom-left-radius:5px}
.dots{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:#fff;border:1px solid #e6e8ec;border-radius:16px}
.dots i{width:7px;height:7px;border-radius:50%;background:#9aa0aa;animation:b 1.2s infinite ease-in-out}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
.card{align-self:stretch;background:#fff;border:1px solid #e6e8ec;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:8px;animation:in .18s ease-out}
.card h2{font-size:14.5px;font-weight:650}
.card input{width:100%;min-height:42px;padding:9px 12px;border:1px solid #d5d8de;border-radius:10px;background:#fff;font-size:16px}
.card input:focus,.composer input:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px rgba(120,120,120,.18)}
.err{color:#b42318;font-size:13px}
.row{display:flex;gap:8px}
.btn{min-height:42px;padding:0 16px;border-radius:21px;border:0;background:var(--accent);color:var(--accent-text);font-weight:650;cursor:pointer;flex:1}
.btn.ghost{background:transparent;color:#5b616c;flex:none;font-weight:500}
.btn:disabled{opacity:.55;cursor:default}
.composer{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e6e8ec;background:#fff;flex:none}
.composer input{flex:1;min-width:0;min-height:44px;padding:0 14px;border:1px solid #d5d8de;border-radius:22px;font-size:16px;background:#fff}
.send{width:44px;height:44px;border-radius:50%;border:0;background:var(--accent);color:var(--accent-text);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}
.send:disabled{opacity:.5;cursor:default}
.foot{flex:none;text-align:center;font-size:11.5px;color:#7a808b;padding:0 0 8px;background:#fff}
.foot a{color:inherit;text-decoration:none}.foot a:hover{text-decoration:underline}
.ts{position:absolute;left:-9999px;top:0}
.ts.show{left:50%;top:auto;bottom:112px;transform:translateX(-50%);background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:12px;box-shadow:0 6px 24px rgba(0,0,0,.18);z-index:5;text-align:center;max-width:94%}
.ts p{font-size:13px;margin-bottom:8px;color:#444}
@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes b{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
@media (prefers-reduced-motion:reduce){.msg,.card{animation:none}.dots i{animation:none;opacity:.7}}
`;

/** Full HTML of /widget/<key>. The chat itself runs in /widget-chat.js; config is passed as JSON. */
export function renderChatPage(o: ChatPageOptions): string {
  const { widget } = o;
  const strings = widgetStrings(widget.contentLanguage);
  const rtl = RTL_LANGUAGES.includes(widget.contentLanguage);
  const config = {
    key: widget.key,
    name: widget.name,
    logo: o.logoUrl,
    greeting: widget.greeting,
    strings,
    turnstileSiteKey: o.turnstileSiteKey,
    mode: o.mode,
    origin: o.origin,
    page: o.page,
  };
  return `<!doctype html>
<html lang="en" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>${esc(widget.name)}</title>
<style nonce="${o.nonce}">:root{--accent:${widget.accent};--accent-text:${widget.accentText}}${CSS}</style>
</head>
<body>
<div id="app" class="panel"></div>
<script id="bp-config" type="application/json">${safeJson(config)}</script>
<script src="/widget-chat.js" defer></script>
</body>
</html>`;
}

export function unavailablePage(nonce: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chat</title><style nonce="${nonce}">body{font:14px system-ui,sans-serif;color:#555;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style></head><body>Chat is not available.</body></html>`;
}
