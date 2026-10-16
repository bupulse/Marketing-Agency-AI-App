// Apps that are not connected yet (docs/CONTENT.md): posts are still drafted for them and, once approved, go out as a
// "post it yourself" reminder. Autopilot stores such an app in its account list as "network:<app>". Pure.
import { NETWORKS, type Network } from "@/lib/social/types";

export const BY_HAND_PREFIX = "network:";

export const byHandId = (network: Network) => `${BY_HAND_PREFIX}${network}`;

/** The app of a "network:<app>" id, or null for a real connection id. */
export function byHandNetwork(id: string): Network | null {
  if (!id.startsWith(BY_HAND_PREFIX)) return null;
  const network = id.slice(BY_HAND_PREFIX.length);
  return (NETWORKS as readonly string[]).includes(network) ? (network as Network) : null;
}

/** Networks a content version was written for when its versions say nothing. */
export const DEFAULT_DRAFT_NETWORKS: readonly Network[] = ["instagram", "facebook", "linkedin"];

/** The apps to draft for: one post per usable account, and one reminder post per written-for app with no usable account. */
export function draftTargets<C extends { id: string; provider: string }>(
  usable: readonly C[],
  writtenFor: readonly Network[],
): { connection: C | null; network: Network }[] {
  const connected = new Set(usable.map((c) => c.provider));
  const wanted = writtenFor.length ? writtenFor : DEFAULT_DRAFT_NETWORKS;
  return [
    ...usable.map((c) => ({ connection: c, network: c.provider as Network })),
    ...NETWORKS.filter((n) => wanted.includes(n) && !connected.has(n)).map((network) => ({ connection: null, network })),
  ];
}
