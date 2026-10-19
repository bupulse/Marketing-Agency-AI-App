// The creative brain of the video engine (docs/research/BRAIN.md): the database of how winning marketing videos are
// made, as committed JSON in ./data, built from the researchers' rows in docs/research/reels (ingest.ts writes the
// evidence index; the hooks, formats, captions, rules and sectors are curated from the research). This file loads it
// with its types and checks it: every enum value, every id, every cross-reference. select.ts picks from it per brief.
import { BRAIN } from "./database";
import { ENGINES, FORMATS, HOOK_NEEDS, HOOK_TYPES, PURPOSES, PLATFORMS, RESEARCH_SOURCES, RULE_STAGES, SECTORS, type BrainData } from "./types";

export * from "./types";
export { BRAIN, SAFE_AREAS, evidenceById, formatById, formatForTemplate, hookById, safeAreaFor, sectorById, type SafeArea } from "./database";
export { MIN_POSTS, PRIOR_POSTS, STRONG_POSTS, WEIGHTS, checkOutcome, outcomesLine, performance, rankWithOutcomes, type Candidate, type CandidateKind, type RankedCandidate } from "./outcomes";
export { planSeries, type SeriesOptions, type SeriesPost } from "./series";
export { MAX_HOOK_WORDS, firstCommentFor, suggestHooks, type HookSuggestion, type SuggestBrief } from "./suggest";
export { FRENCH_COMMERCE, KINYARWANDA_COMMERCE, PREFERRED_PHRASES, checkLanguage, hasKinyarwanda, languageTextsOf, type LanguageIssue, type LanguageText } from "./language";



/** Lists from the engines the brain refers to (passed in by the test so this file stays dependency-free). */
export type BrainRefs = { claudeTemplates?: string[]; seedanceFormats?: string[]; seedanceKinds?: string[]; musicMoods?: readonly string[] };

/** The rules about generated footage: the only ones that may cite an AI-made clip (Evidence.ai). */
export const AI_RULES = ["ai-real-product", "ai-real-place", "ai-real-face", "ai-disclose", "ai-label", "look-real", "native-look", "no-fake-customers"];

/** Every problem in the database, in plain English; [] when it is sound. Pure. */
export function checkBrain(data: BrainData = BRAIN, refs: BrainRefs = {}): string[] {
  const problems: string[] = [];
  const say = (where: string, what: string) => problems.push(`${where}: ${what}`);
  const evidence = new Set(data.evidence.map((e) => e.id));
  const hooks = new Set(data.hooks.map((h) => h.id));
  const oneOf = (where: string, field: string, value: unknown, allowed: readonly string[]) => {
    if (typeof value !== "string" || !allowed.includes(value)) say(where, `${field} "${String(value)}" is not one of ${allowed.join(", ")}`);
  };
  const allOf = (where: string, field: string, values: unknown, allowed: readonly string[], nonEmpty = true) => {
    if (!Array.isArray(values)) return say(where, `${field} must be a list`);
    if (nonEmpty && !values.length) say(where, `${field} is empty`);
    values.forEach((v) => oneOf(where, field, v, allowed));
  };
  const scams = new Set(data.evidence.filter((e) => e.scam).map((e) => e.id));
  // AI-made clips (TikTok round 4: mostly AI studios' sales demos) are never positive evidence for a hook, a format, a
  // sector or a caption; only the AI rules may cite them, as what was seen.
  const aiMade = new Set(data.evidence.filter((e) => e.ai && e.ai !== "none").map((e) => e.id));
  /** Rules that may cite an income-chain or scam row (as what not to copy); nothing else learns from them. */
  const SCAM_CITERS = new Set(["rule no-fake-income", "rule no-income-promise"]);
  /** Rules about generated footage that may cite AI-made clips as what was seen (tiktok-patterns.md, section F). */
  const AI_CITERS = new Set(AI_RULES.map((id) => `rule ${id}`));
  const cites = (where: string, ids: unknown, allowEmpty = false) => {
    if (!Array.isArray(ids)) return say(where, "evidence must be a list");
    if (!ids.length && !allowEmpty) say(where, "has no evidence");
    for (const id of ids) {
      if (!evidence.has(id)) say(where, `evidence "${id}" is not in evidence.json`);
      else if (scams.has(id) && !SCAM_CITERS.has(where)) say(where, `evidence "${id}" is an income-chain or scam post; only the fake-income and income-promise don'ts may cite it`);
      else if (aiMade.has(id) && !AI_CITERS.has(where)) say(where, `evidence "${id}" is an AI-made clip; only the AI rules may cite it`);
    }
  };
  const unique = (name: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id) say(name, "an entry has no id");
      if (seen.has(id)) say(name, `id "${id}" is used twice`);
      seen.add(id);
    }
  };
  const text = (where: string, field: string, v: unknown) => {
    if (typeof v !== "string" || !v.trim()) say(where, `${field} is missing`);
  };

  unique("evidence", data.evidence.map((e) => e.id));
  for (const e of data.evidence) {
    oneOf(`evidence ${e.id}`, "source", e.source, RESEARCH_SOURCES);
    if (!Number.isInteger(e.line) || e.line < 1) say(`evidence ${e.id}`, "line must be a positive whole number");
    if (!(e.strength >= 0 && e.strength <= 1)) say(`evidence ${e.id}`, "strength must be between 0 and 1");
    if (e.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) say(`evidence ${e.id}`, `date "${e.date}" is not YYYY-MM-DD`);
    if (e.variantsLive !== null && !(Number.isInteger(e.variantsLive) && e.variantsLive >= 1)) say(`evidence ${e.id}`, "variantsLive must be null or a whole number from 1");
    if (e.source !== "facebook" && e.variantsLive !== null) say(`evidence ${e.id}`, "variantsLive is only for Facebook rows");
  }

  unique("hooks", data.hooks.map((h) => h.id));
  for (const h of data.hooks) {
    const where = `hook ${h.id}`;
    text(where, "name", h.name);
    text(where, "pattern", h.pattern);
    text(where, "visual", h.visual);
    oneOf(where, "type", h.type, HOOK_TYPES);
    allOf(where, "platforms", h.platforms, PLATFORMS);
    allOf(where, "sectors", h.sectors, [...SECTORS, "any"]);
    allOf(where, "formats", h.formats, FORMATS);
    allOf(where, "engines", h.engines, ENGINES);
    allOf(where, "needs", h.needs, HOOK_NEEDS, false);
    if (!Array.isArray(h.examples) || !h.examples.length) say(where, "has no example lines");
    cites(where, h.evidence);
    if (h.evidence.length < 3 && !h.weak) say(where, `cites ${h.evidence.length} rows: mark it "weak" (early evidence)`);
  }

  unique("formats", data.formats.map((f) => f.id));
  for (const id of FORMATS) if (!data.formats.some((f) => f.id === id)) say("formats", `format "${id}" is missing`);
  for (const f of data.formats) {
    const where = `format ${f.id}`;
    oneOf(where, "id", f.id, FORMATS);
    allOf(where, "engines", f.engines, ENGINES);
    text(where, "what", f.what);
    text(where, "voice", f.voice);
    text(where, "music", f.music);
    text(where, "cta", f.cta);
    if (!f.timeline?.length) say(where, "has no timeline");
    else {
      if (f.timeline[0].from !== 0) say(where, "the timeline must start at 0");
      if (f.timeline[0].role !== "hook") say(where, "the first beat must be the hook");
      if (f.timeline[f.timeline.length - 1].role !== "cta") say(where, "the last beat must be the call to action");
      if (f.timeline[f.timeline.length - 1].to !== f.refSeconds) say(where, `the timeline must end at refSeconds (${f.refSeconds})`);
      f.timeline.forEach((b, i) => {
        if (!(b.to > b.from)) say(where, `beat ${i + 1} ends before it starts`);
        if (i && b.from !== f.timeline[i - 1].to) say(where, `beat ${i + 1} does not start where beat ${i} ends`);
        text(where, `beat ${i + 1}`, b.beat);
        text(where, `beat ${i + 1} onScreen`, b.onScreen);
      });
    }
    for (const p of PLATFORMS) {
      const r = f.length?.[p];
      if (!Array.isArray(r) || r.length !== 2 || !(r[0] > 0 && r[0] <= r[1])) say(where, `length for ${p} must be [min, max]`);
    }
    if (!(f.cutsPer10s?.length === 2 && f.cutsPer10s[0] <= f.cutsPer10s[1])) say(where, "cutsPer10s must be [min, max]");
    for (const id of f.hooks) if (!hooks.has(id)) say(where, `hook "${id}" does not exist`);
    if (refs.claudeTemplates) for (const t of f.claudeTemplates) if (!refs.claudeTemplates.includes(t)) say(where, `Claude template "${t}" does not exist`);
    if (refs.seedanceFormats && f.seedanceFormat !== null && !refs.seedanceFormats.includes(f.seedanceFormat)) say(where, `Seedance format "${f.seedanceFormat}" does not exist`);
    cites(where, f.evidence);
  }

  const platforms = data.captions.platforms.map((p) => p.platform);
  for (const p of PLATFORMS) if (!platforms.includes(p)) say("captions", `platform "${p}" is missing`);
  for (const c of data.captions.platforms) {
    const where = `captions ${c.platform}`;
    oneOf(where, "platform", c.platform, PLATFORMS);
    if (!c.formulas.length) say(where, "has no formulas");
    unique(where, c.formulas.map((f) => f.id));
    for (const f of c.formulas) {
      allOf(`${where} ${f.id}`, "sectors", f.sectors, [...SECTORS, "any"]);
      if (f.purposes) allOf(`${where} ${f.id}`, "purposes", f.purposes, PURPOSES);
      if (f.evidence.length < 3 && !f.weak) say(`${where} ${f.id}`, `cites ${f.evidence.length} rows: mark it "weak" (early evidence)`);
      if (!f.examples.length) say(`${where} ${f.id}`, "has no example");
      cites(`${where} ${f.id}`, f.evidence);
    }
    cites(where, c.evidence);
  }
  unique("trade routes", data.captions.tradeRoutes.map((r) => r.id));
  text("first comment", "why", data.captions.firstComment?.why);
  if (!data.captions.firstComment?.en.length || !data.captions.firstComment?.rw.length) say("first comment", "needs English and Kinyarwanda lines");
  cites("first comment", data.captions.firstComment?.evidence ?? []);

  unique("rules", data.rules.map((r) => r.id));
  for (const r of data.rules) {
    const where = `rule ${r.id}`;
    text(where, "rule", r.rule);
    text(where, "why", r.why);
    oneOf(where, "kind", r.kind, ["do", "dont"]);
    oneOf(where, "stage", r.stage, RULE_STAGES);
    oneOf(where, "engine", r.engine, [...ENGINES, "both"]);
    oneOf(where, "origin", r.origin, ["tiktok-A", "tiktok-B", "tiktok-3d", "facebook", "rwanda", "instagram", "youtube", "captions", "comments", "engine"]);
    if (![1, 2, 3].includes(r.priority)) say(where, "priority must be 1, 2 or 3");
    if (r.platforms) allOf(where, "platforms", r.platforms, PLATFORMS);
    if (r.sectors) allOf(where, "sectors", r.sectors, SECTORS);
    if (r.formats) allOf(where, "formats", r.formats, FORMATS);
    if (r.purposes) allOf(where, "purposes", r.purposes, PURPOSES);
    // A page's own organic reel says nothing about what sells in an ad.
    if (r.purposes && !r.purposes.includes("post")) for (const id of r.evidence) if (data.evidence.find((e) => e.id === id)?.organic) say(where, `an ad rule cites the organic post ${id}`);
    // Owner and policy rules may stand without a research row; research rules must cite one.
    cites(where, r.evidence, r.origin === "engine");
    // Fewer than 3 rows is early evidence and must say so (brain-evidence-audit.md).
    if (r.origin !== "engine" && r.evidence.length < 3 && !r.weak) say(where, `cites ${r.evidence.length} rows: mark it "weak" (early evidence)`);
  }

  unique("sectors", data.sectors.map((s) => s.id));
  for (const id of SECTORS) if (!data.sectors.some((s) => s.id === id)) say("sectors", `sector "${id}" is missing`);
  for (const s of data.sectors) {
    const where = `sector ${s.id}`;
    oneOf(where, "id", s.id, SECTORS);
    allOf(where, "formats", s.formats, FORMATS);
    if (!s.words.length) say(where, "has no words");
    if (!s.settings.length) say(where, "has no settings");
    if (!s.offers.length) say(where, "has no offer wording");
    text(where, "cta", s.cta);
    text(where, "longestRunning", s.longestRunning);
    if (!s.hooks.length) say(where, "has no hooks");
    for (const id of s.hooks) if (!hooks.has(id)) say(where, `hook "${id}" does not exist`);
    if (refs.seedanceKinds && s.seedanceKind !== null && !refs.seedanceKinds.includes(s.seedanceKind)) say(where, `Seedance business kind "${s.seedanceKind}" does not exist`);
    if (s.music && refs.musicMoods) for (const m of s.music.moods) if (!refs.musicMoods.includes(m)) say(where, `music mood "${m}" is not in the music library`);
    cites(where, s.evidence, s.weak === true);
  }
  return problems;
}
