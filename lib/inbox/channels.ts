import "server-only";
import type { ChannelAdapter, ChannelKind } from "./types";

// The channel adapters in this build. Each channel module calls registerChannel() when it is imported;
// lib/inbox/all-channels.ts imports them all, so importing that file once (the engine does) registers every channel.

const adapters = new Map<ChannelKind, ChannelAdapter>();

export function registerChannel(adapter: ChannelAdapter): void {
  adapters.set(adapter.kind, adapter);
}

/** The adapter for a channel, or null when this build has none. */
export function channelAdapter(kind: ChannelKind): ChannelAdapter | null {
  return adapters.get(kind) ?? null;
}

export function registeredChannels(): ChannelKind[] {
  return [...adapters.keys()];
}
