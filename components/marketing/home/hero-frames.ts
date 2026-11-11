// Pure helpers for the home page hero's frame sequence (avatar-hero.tsx, docs/design/front-page-motion.md).

/** Stills in public/marketing/avatar: m00..m35 (phones, 360x420) and d00..d35 (wider screens, 600x700). */
export const FRAME_COUNT = 36;

export const frameSrc = (set: "m" | "d", i: number) => `/marketing/avatar/${set}${String(i).padStart(2, "0")}.webp`;

/** First, last, then halves, quarters, eighths...: every prefix of this list covers the whole timeline. */
export function loadOrder(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const order: number[] = [0, count - 1];
  const seen = new Set(order);
  for (let step = Math.floor((count - 1) / 2); step >= 1; step = Math.floor(step / 2)) {
    for (let i = 0; i < count; i += step) {
      if (!seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
    }
  }
  return order;
}

/** Scroll progress (0..1) to a frame position: the frames play from 8% to 78% of the scene, then the reveal holds. */
export function frameAt(p: number, count = FRAME_COUNT) {
  const t = Math.min(1, Math.max(0, (p - 0.08) / 0.7));
  return t * (count - 1);
}

/** Which story beat the hero shows: 1 "Meet your new presenter", 2 "Now look closer", 3 "It was AI all along". */
export function beatAt(p: number): "1" | "2" | "3" {
  return p < 0.27 ? "1" : p < 0.62 ? "2" : "3";
}
