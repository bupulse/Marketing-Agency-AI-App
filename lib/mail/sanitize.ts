// Cleans HTML written in the B Mail composer before it is sent or stored: only simple formatting survives (bold,
// italic, underline, lists, links, quotes, line breaks), every other tag and attribute is dropped. Pure.

const ALLOWED = new Set(["b", "strong", "i", "em", "u", "br", "p", "div", "ul", "ol", "li", "a", "blockquote", "span", "h3", "h4"]);

export function sanitizeComposerHtml(html: string): string {
  const noScripts = html.replace(/<(script|style|iframe|object|embed|form|svg|math)[\s\S]*?<\/\1\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  return noScripts.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (tag, rawName: string, attrs: string) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED.has(name)) return "";
    if (tag.startsWith("</")) return `</${name}>`;
    if (name === "a") {
      const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const href = (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim();
      if (!/^(https?:|mailto:)/i.test(href)) return "<a>";
      return `<a href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">`;
    }
    return name === "br" ? "<br>" : `<${name}>`;
  });
}
