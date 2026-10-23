// The Checker (docs/IMAGE_ENGINE.md): reads every finished picture with Gemini's vision and compares what is written in
// it with the words that were asked for. A misspelt headline, a number or price nobody gave, or a missing product is a
// problem; the Editor gets one try to fix it (engine.ts). This file's judge is pure (tested); the reading is in check.ts.

export type Expected = { headline: string; subline: string; cta: string; productShown: boolean };
export type Seen = { texts: string[]; productVisible: boolean };
export type Verdict = { ok: boolean; problems: string[]; fix: string | null };

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Edit distance (Levenshtein), for a few-letters-wrong check. */
export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** True when the expected words are in the picture, word for word (a letter or two of reading noise forgiven). */
export function wordsShown(expected: string, seen: readonly string[]): boolean {
  const want = norm(expected);
  if (!want) return true;
  const all = norm(seen.join(" "));
  if (all.includes(want)) return true;
  // Compare with every run of the same number of words in what was read.
  const words = all.split(" ");
  const n = want.split(" ").length;
  const allowed = Math.max(1, Math.floor(want.length * 0.08));
  for (let i = 0; i + n <= words.length; i++) if (distance(words.slice(i, i + n).join(" "), want) <= allowed) return true;
  return false;
}

const numbers = (s: string) => [...s.matchAll(/\d[\d,.]*/g)].map((m) => m[0].replace(/[^\d]/g, "")).filter(Boolean);

export function judge(expected: Expected, seen: Seen): Verdict {
  const problems: string[] = [];
  const fixes: string[] = [];
  for (const [label, words] of [["headline", expected.headline], ["small line", expected.subline], ["button", expected.cta]] as const) {
    if (words && !wordsShown(words, seen.texts)) {
      problems.push(`The ${label} is not written correctly.`);
      fixes.push(`Write the ${label} exactly as: "${words}".`);
    }
  }
  const allowed = new Set(numbers([expected.headline, expected.subline, expected.cta].join(" ")));
  const extra = [...new Set(seen.texts.flatMap(numbers))].filter((n) => !allowed.has(n));
  if (extra.length) {
    problems.push(`The picture shows numbers nobody gave: ${extra.join(", ")}.`);
    fixes.push(`Remove every number that is not in the words above (${extra.join(", ")}).`);
  }
  if (expected.productShown && !seen.productVisible) {
    problems.push("The product cannot be seen clearly.");
    fixes.push("Make the product from the original photo clearly visible.");
  }
  return { ok: problems.length === 0, problems, fix: fixes.length ? `${fixes.join(" ")} Keep everything else exactly the same.` : null };
}
