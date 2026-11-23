// Small HTML helpers for outgoing mail and for showing received mail safely. Pure.

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain text typed in the composer as simple HTML paragraphs (links made clickable). */
export function textToHtml(text: string): string {
  const linked = (s: string) => escapeHtml(s).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 1em">${p.split("\n").map(linked).join("<br>")}</p>`)
    .join("");
}

/**
 * Received HTML for display inside a sandboxed iframe (no scripts, no forms, no same-origin): a strict
 * Content-Security-Policy, links open in a new tab, and remote images blocked until the reader allows them (tracking
 * pixels). cid: images are rewritten by the caller to our own attachment links.
 */
export function safeEmailDocument(html: string, opts: { allowRemote: boolean; dark?: boolean }): string {
  const img = opts.allowRemote ? "img-src https: data: blob:" : "img-src data: blob: 'self'";
  const csp = `default-src 'none'; ${img}; style-src 'unsafe-inline'; font-src https: data:; media-src 'none'; frame-src 'none'`;
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
html,body{margin:0;padding:0}body{font:15px/1.6 -apple-system,'SF Pro Text',Inter,system-ui,sans-serif;color:${opts.dark ? "#f2f2f7" : "#1d1d1f"};word-wrap:break-word;overflow-wrap:anywhere}
img{max-width:100%;height:auto}table{max-width:100%}a{color:#1f5ae6}blockquote{margin:0 0 0 .5em;padding-left:.8em;border-left:2px solid #d1d5db;color:#3c3c43}
</style></head><body>${body}</body></html>`;
}

/** The quoted earlier message below a reply ("On <date>, <name> wrote:"). */
export function quoteBlock(opts: { date: Date; fromName: string; fromAddress: string; text: string }): { text: string; html: string } {
  const when = opts.date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
  const who = opts.fromName ? `${opts.fromName} <${opts.fromAddress}>` : opts.fromAddress;
  const head = `On ${when}, ${who} wrote:`;
  const quoted = opts.text.split("\n").map((l) => `> ${l}`).join("\n");
  return {
    text: `${head}\n${quoted}`,
    html: `<div class="bmail-quote"><div style="color:#5c5c63;margin:0 0 6px">${escapeHtml(head)}</div><blockquote style="margin:0 0 0 .5em;padding-left:.8em;border-left:2px solid #d1d5db;color:#3c3c43">${textToHtml(opts.text)}</blockquote></div>`,
  };
}

/** The "Forwarded message" header block. */
export function forwardBlock(opts: { date: Date; fromName: string; fromAddress: string; subject: string; to: string; text: string }): { text: string; html: string } {
  const when = opts.date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
  const head = ["---------- Forwarded message ---------", `From: ${opts.fromName ? `${opts.fromName} <${opts.fromAddress}>` : opts.fromAddress}`, `Date: ${when}`, `Subject: ${opts.subject}`, `To: ${opts.to}`].join("\n");
  return { text: `${head}\n\n${opts.text}`, html: `<div style="color:#5c5c63">${escapeHtml(head).replace(/\n/g, "<br>")}</div><br>${textToHtml(opts.text)}` };
}
