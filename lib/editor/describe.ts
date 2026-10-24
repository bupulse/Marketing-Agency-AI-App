// What an edit changed, in plain English (docs/research/EDITOR.md): the lines the Training Lab saves with an edited reel
// so the engines can learn from them. It compares the spec the reel was opened with against the edited one, matching
// shots by the piece of clip they show (a trim or a caption change keeps the match; a split makes a second piece).
// Shots are numbered as in the original. Deterministic and capped. Pure.
import type { Layer, MotionSpec, Scene } from "@/lib/video-engine/spec";

export const MAX_LINES = 30;
const r1 = (v: number) => Math.round(v * 10) / 10;
const secs = (v: number) => `${r1(v)} s`;
const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
const quote = (s: string) => `"${s.replace(/\s+/g, " ").trim().slice(0, 60)}"`;

type Clip = { url: string; start: number };
const clipOf = (s: Scene): Clip | null => {
  const v = s.layers.find((l) => l.kind === "video");
  return v && v.kind === "video" ? { url: v.url, start: v.start } : null;
};
const texts = (s: Scene) => s.layers.flatMap((l) => (l.kind === "text" ? [l.text.replace(/\s+/g, " ").trim()] : []));
const shapes = (s: Scene) => s.layers.flatMap((l) => (l.kind === "shape" ? [l.shape] : []));
const zoomOf = (s: Scene) => {
  const l = s.layers.find((x: Layer) => x.kind === "video" || x.kind === "photo");
  return l?.keyframes?.[0]?.scale ?? 1;
};
const overlaps = (a: Scene, b: Scene) => {
  const x = clipOf(a);
  const y = clipOf(b);
  return !!x && !!y && x.url === y.url && x.start < y.start + b.seconds && y.start < x.start + a.seconds;
};

/** For each shot of `before`, the index of its shot in `after` (or -1), and the `after` shots left over. */
function match(before: Scene[], after: Scene[]): { to: number[]; spare: number[] } {
  const to = before.map(() => -1);
  const taken = new Set<number>();
  const take = (i: number, test: (a: Scene, b: Scene) => boolean) => {
    if (to[i] >= 0) return;
    const j = after.findIndex((a, k) => !taken.has(k) && test(before[i], a));
    if (j >= 0) {
      to[i] = j;
      taken.add(j);
    }
  };
  // The same piece of the same clip, then a trimmed one (the pieces overlap), then shots with no clip by their first words.
  before.forEach((_, i) => take(i, (b, a) => { const x = clipOf(b), y = clipOf(a); return !!x && !!y && x.url === y.url && Math.abs(x.start - y.start) < 0.01; }));
  before.forEach((_, i) => take(i, overlaps));
  before.forEach((_, i) => take(i, (b, a) => !clipOf(b) && !clipOf(a) && !!texts(b)[0] && texts(b)[0] === texts(a)[0]));
  return { to, spare: after.map((_, k) => k).filter((k) => !taken.has(k)) };
}

/** The shots that kept their order among themselves: the longest increasing run of `to` (ties broken by the earliest). */
function stayers(to: number[]): Set<number> {
  const idx = to.map((t, i) => [t, i] as const).filter(([t]) => t >= 0);
  const best: number[][] = [];
  for (const [t, i] of idx) {
    let chain: number[] = [];
    for (const prev of best) if (to[prev[prev.length - 1]] < t && prev.length > chain.length) chain = prev;
    best.push([...chain, i]);
  }
  const longest = best.reduce<number[]>((a, b) => (b.length > a.length ? b : a), []);
  return new Set(longest);
}

export function describeEdit(before: MotionSpec, after: MotionSpec): string[] {
  const { to, spare } = match(before.scenes, after.scenes);
  const out: string[] = [];
  const name = (i: number) => `Shot ${i + 1}`;

  before.scenes.forEach((s, i) => {
    if (to[i] < 0) out.push(`${name(i)} was removed (${secs(s.seconds)}).`);
  });

  // A piece left over that shows part of a kept shot's clip is the second half of a split.
  const splitFrom = new Map<number, number>();
  for (const k of spare) {
    const i = before.scenes.findIndex((b, bi) => to[bi] >= 0 && overlaps(b, after.scenes[k]) && clipOf(after.scenes[k])!.start >= clipOf(b)!.start);
    if (i >= 0) splitFrom.set(k, i);
  }
  for (const [k, i] of splitFrom) out.push(`${name(i)} was split in two: ${secs(after.scenes[to[i]].seconds)} and ${secs(after.scenes[k].seconds)}.`);
  for (const k of spare) if (!splitFrom.has(k)) out.push(`A new shot was added (${secs(after.scenes[k].seconds)}).`);

  before.scenes.forEach((b, i) => {
    const a = after.scenes[to[i]];
    if (!a || [...splitFrom.values()].includes(i)) return;
    const x = clipOf(b);
    const y = clipOf(a);
    if (Math.abs(a.seconds - b.seconds) >= 0.05) out.push(`${name(i)} was trimmed from ${secs(b.seconds)} to ${secs(a.seconds)}.`);
    if (x && y && Math.abs(y.start - x.start) >= 0.05) out.push(`${name(i)} now starts ${secs(Math.abs(y.start - x.start))} ${y.start > x.start ? "later" : "earlier"} in its clip.`);
  });

  const stay = stayers(to);
  before.scenes.forEach((_, i) => {
    if (to[i] >= 0 && !stay.has(i)) out.push(`${name(i)} was moved to position ${to[i] + 1}.`);
  });

  before.scenes.forEach((b, i) => {
    const a = after.scenes[to[i]];
    if (!a) return;
    const was = b.transition ?? "fade";
    const now = a.transition ?? "fade";
    if (was !== now && to[i] > 0) out.push(`The way ${name(i).toLowerCase()} comes in changed from ${was} to ${now}.`);
    if (Math.abs(zoomOf(b) - zoomOf(a)) >= 0.02) out.push(`${name(i)} zoom changed from ${zoomOf(b).toFixed(2)}x to ${zoomOf(a).toFixed(2)}x.`);
    const tb = texts(b);
    const ta = texts(a);
    for (let n = 0; n < Math.min(tb.length, ta.length); n++) if (tb[n] !== ta[n]) out.push(`${name(i)} words changed: ${quote(tb[n])} -> ${quote(ta[n])}.`);
    for (const t of ta.slice(tb.length)) out.push(`${name(i)}: text added ${quote(t)}.`);
    for (const t of tb.slice(ta.length)) out.push(`${name(i)}: text removed ${quote(t)}.`);
    const sb = shapes(b);
    const sa = shapes(a);
    for (const shape of new Set([...sb, ...sa])) {
      const d = sa.filter((x) => x === shape).length - sb.filter((x) => x === shape).length;
      if (d > 0) out.push(`${name(i)}: ${d === 1 ? `${article(shape)} ${shape} shape` : `${d} ${shape} shapes`} added.`);
      if (d < 0) out.push(`${name(i)}: ${d === -1 ? `${article(shape)} ${shape} shape` : `${-d} ${shape} shapes`} removed.`);
    }
  });

  const g0 = before.look?.grade ?? "none";
  const g1 = after.look?.grade ?? "none";
  if (g0 !== g1) out.push(`The colour look changed from ${g0} to ${g1}.`);
  const t0 = before.scenes.reduce((t, s) => t + s.seconds, 0);
  const t1 = after.scenes.reduce((t, s) => t + s.seconds, 0);
  if (Math.abs(t0 - t1) >= 0.05) out.push(`The total length changed from ${secs(t0)} to ${secs(t1)}.`);

  return out.length > MAX_LINES ? [...out.slice(0, MAX_LINES), `...and ${out.length - MAX_LINES} more changes.`] : out;
}
