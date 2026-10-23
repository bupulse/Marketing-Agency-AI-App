// The "from the guide" line under an AI answer or an agent's suggestions: the guide PAGES the answer used, each once,
// at most two, with a short title ("Sign-up · Billing"), never every section of the same page. Pure.

export const MAX_SOURCES = 2;

/** "Sign-up, onboarding and account states" → "Sign-up"; "Pricing page: the plan quiz…" → "Pricing page"; "Social connections (Channels)" → "Social connections". */
export function shortGuideTitle(title: string): string {
  const cut = title.split(/[,:(]| – | — /)[0].trim();
  return (cut || title).slice(0, 40);
}

/** One entry per guide file, in the order the answer cited them, with the file's page as the link. */
export function pageSources(sections: { file: string; title: string; page: string | null }[]): { title: string; href: string | null }[] {
  const seen = new Set<string>();
  const out: { title: string; href: string | null }[] = [];
  for (const s of sections) {
    if (seen.has(s.file)) continue;
    seen.add(s.file);
    out.push({ title: shortGuideTitle(s.title), href: s.page });
    if (out.length === MAX_SOURCES) break;
  }
  return out;
}
