// Cleans HTML written in the B Mail composer before it is sent or stored. Gmail-style formatting survives (owner
// 25 Nov 2026): bold, italic, underline, strikethrough, lists, indents, quotes, links, alignment, font, size, text and
// highlight colour. Every other tag and attribute is dropped, and style values must match a strict pattern (no url(),
// no expressions), so nothing can load or run. Pure.

const ALLOWED = new Set(["b", "strong", "i", "em", "u", "s", "strike", "br", "p", "div", "ul", "ol", "li", "a", "blockquote", "span", "font", "h3", "h4"]);
/** Elements that may keep a cleaned style attribute. */
const STYLED = new Set(["span", "div", "p", "blockquote", "font", "li", "ul", "ol", "h3", "h4", "b", "i", "u", "s", "strong", "em"]);

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i;
const FAMILY = /^[a-z0-9 ,'"-]{1,120}$/i;
const LENGTH = /^(0|-?\d{1,3}(\.\d+)?(px|em|pt|rem|%)?)$/i;
const BOX = (v: string) => v.split(/\s+/).length <= 4 && v.split(/\s+/).every((p) => LENGTH.test(p) || p === "auto");

const STYLE_RULES: Record<string, (v: string) => boolean> = {
  "text-align": (v) => /^(left|right|center|justify|start|end)$/i.test(v),
  "margin": BOX,
  "margin-left": BOX,
  "margin-right": BOX,
  "padding": BOX,
  "padding-left": BOX,
  "border": (v) => /^(none|0)$/i.test(v),
  "color": (v) => COLOR.test(v),
  "background-color": (v) => COLOR.test(v),
  "font-family": (v) => FAMILY.test(v),
  "font-size": (v) => /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|\d{1,2}(\.\d+)?(px|pt|em|rem|%))$/i.test(v),
  "font-weight": (v) => /^(bold|bolder|normal|[1-9]00)$/i.test(v),
  "font-style": (v) => /^(italic|normal|oblique)$/i.test(v),
  "text-decoration": (v) => /^(none|underline|line-through)( (underline|line-through))?$/i.test(v),
  "text-decoration-line": (v) => /^(none|underline|line-through)( (underline|line-through))?$/i.test(v),
};

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Keeps only allowed properties whose values pass their pattern. Exported for tests. */
export function cleanStyle(style: string): string {
  const decoded = style.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  if (/[\\<>]|\/\*|url\s*\(|expression|@import/i.test(decoded)) return "";
  const out: string[] = [];
  for (const part of decoded.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim().replace(/\s+/g, " ");
    if (value && STYLE_RULES[prop]?.(value)) out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

export function sanitizeComposerHtml(html: string): string {
  const noScripts = html.replace(/<(script|style|iframe|object|embed|form|svg|math|template|noscript)[\s\S]*?<\/\1\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  return noScripts.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (tag, rawName: string, attrs: string) => {
    let name = rawName.toLowerCase();
    if (!ALLOWED.has(name)) return "";
    if (name === "strike") name = "s";
    if (tag.startsWith("</")) return `</${name}>`;
    if (name === "br") return "<br>";
    if (name === "a") {
      const href = attr(attrs, "href") ?? "";
      if (!/^(https?:|mailto:)/i.test(href)) return "<a>";
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">`;
    }
    const parts: string[] = [];
    if (name === "font") {
      const face = attr(attrs, "face");
      const size = attr(attrs, "size");
      const color = attr(attrs, "color");
      if (face && FAMILY.test(face)) parts.push(`face="${esc(face)}"`);
      if (size && /^[1-7]$/.test(size)) parts.push(`size="${size}"`);
      if (color && COLOR.test(color)) parts.push(`color="${esc(color)}"`);
    }
    if (STYLED.has(name)) {
      const style = cleanStyle(attr(attrs, "style") ?? "");
      if (style) parts.push(`style="${esc(style)}"`);
    }
    return parts.length ? `<${name} ${parts.join(" ")}>` : `<${name}>`;
  });
}
