// The posts of a day's run (docs/CONTENT.md): how many per app (the owner's choice, within the plan's posts per app
// per day, counting what the subject already has today) and which idea goes to which post. Pure.
import { ANGLES, formatFor, type AngleId, type PackFormat } from "@/lib/studio/angles";
import type { Network } from "@/lib/social/types";
import { NETWORK_STYLE } from "./networks";

/**
 * Posts per app for this run: the owner's `perApp` (1 by default), never past the plan's limit counting the posts the
 * subject already has on that app today. Apps already full are skipped with the reason.
 */
export function postsPerApp(input: { networks: readonly Network[]; perApp: number; limit: number; madeToday: Partial<Record<Network, number>> }): { slots: Network[]; skipped: { network: Network; reason: string }[] } {
  const limit = Math.max(1, Math.floor(input.limit));
  const want = Math.min(Math.max(1, Math.floor(input.perApp || 1)), limit);
  const slots: Network[] = [];
  const skipped: { network: Network; reason: string }[] = [];
  for (const network of input.networks) {
    const room = Math.max(0, limit - (input.madeToday[network] ?? 0));
    const n = Math.min(want, room);
    if (n === 0) skipped.push({ network, reason: `${NETWORK_STYLE[network].label} already has ${limit === 1 ? "its post" : `${limit} posts`} for today (your plan allows ${limit} per app a day).` });
    for (let i = 0; i < n; i++) slots.push(network);
  }
  // Every app once before any app twice, so a run cut short still covers them all.
  const order = (network: Network, i: number) => slots.slice(0, i).filter((x) => x === network).length;
  return { slots: slots.map((n, i) => ({ n, k: order(n, i), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.n), skipped };
}

/** Gives each post the idea that suits its app best, in rotation order otherwise. Ideas stay distinct. */
export function assignAngles(angles: readonly AngleId[], slots: readonly Network[]): { angle: AngleId; network: Network; format: PackFormat }[] {
  const left = [...angles];
  return slots.flatMap((network) => {
    if (left.length === 0) return [];
    const rank = (a: AngleId) => {
      const i = ANGLES[a].networks.indexOf(network);
      return i < 0 ? ANGLES[a].networks.length : i;
    };
    const best = left.reduce((b, a) => (rank(a) < rank(b) ? a : b), left[0]);
    left.splice(left.indexOf(best), 1);
    return [{ angle: best, network, format: formatFor(best, network) }];
  });
}

/** A daily posts run's posts (lib/daily-posts): at most `maxPosts`, and per app at most its room, in order. */
export function withinDaily(slots: readonly Network[], daily: { maxPosts: number; room: Partial<Record<Network, number>> }): Network[] {
  const used = new Map<Network, number>();
  const out: Network[] = [];
  for (const n of slots) {
    if (out.length >= Math.max(0, daily.maxPosts)) break;
    if ((used.get(n) ?? 0) >= (daily.room[n] ?? 0)) continue;
    used.set(n, (used.get(n) ?? 0) + 1);
    out.push(n);
  }
  return out;
}
