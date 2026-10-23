// Real time for the support app: Supabase Realtime Broadcast on private topics (lib/support/contract.ts), opened with
// the agent's own session, so the RLS on realtime.messages decides what they hear. Pages subscribe to the topics they
// need; the hub shares one channel per topic and says whether it is live, so a page re-asks every 15 s when it is not.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { REALTIME_EVENT, type RealtimeEvent } from "@/lib/support/contract";

export const POLL_MS = 15_000;

export type LiveStatus = "live" | "connecting" | "down";
type Handler = (event: RealtimeEvent) => void;

export interface LiveHub {
  /** Listens to these topics until the returned function is called. */
  subscribe(topics: string[], handler: Handler): () => void;
  /** "live" when every subscribed topic is connected. */
  status(): LiveStatus;
  onStatus(cb: (s: LiveStatus) => void): () => void;
  close(): void;
}

/** A hub that never connects (the preview pages, a browser without WebSocket): pages poll. */
export const offlineHub = (): LiveHub => ({ subscribe: () => () => {}, status: () => "down", onStatus: () => () => {}, close() {} });

export function createLiveHub(client: Pick<SupabaseClient, "channel" | "removeChannel" | "realtime">, getToken: () => Promise<string | null>): LiveHub {
  const topics = new Map<string, { channel: RealtimeChannel; handlers: Set<Handler>; ok: boolean }>();
  const watchers = new Set<(s: LiveStatus) => void>();
  let ready: Promise<void> | null = null;

  const status = (): LiveStatus => {
    if (!topics.size) return "down";
    const all = [...topics.values()];
    return all.every((t) => t.ok) ? "live" : all.some((t) => t.ok) ? "connecting" : "down";
  };
  const emit = () => watchers.forEach((w) => w(status()));

  // Private channels need the session's token on the socket before the first join.
  const auth = () => (ready ??= getToken().then((t) => (t ? client.realtime.setAuth(t) : undefined)).catch(() => undefined));

  function open(topic: string) {
    const entry = { channel: client.channel(topic, { config: { private: true } }), handlers: new Set<Handler>(), ok: false };
    topics.set(topic, entry);
    entry.channel.on("broadcast", { event: REALTIME_EVENT }, ({ payload }) => entry.handlers.forEach((h) => h(payload as RealtimeEvent)));
    void auth().then(() =>
      entry.channel.subscribe((s) => {
        entry.ok = s === "SUBSCRIBED";
        emit();
      }),
    );
    return entry;
  }

  return {
    subscribe(list, handler) {
      const entries = list.map((t) => topics.get(t) ?? open(t));
      entries.forEach((e) => e.handlers.add(handler));
      emit();
      return () => {
        for (const [topic, e] of topics) {
          if (!entries.includes(e)) continue;
          e.handlers.delete(handler);
          if (!e.handlers.size) {
            topics.delete(topic);
            void client.removeChannel(e.channel);
          }
        }
        emit();
      };
    },
    status,
    onStatus(cb) {
      watchers.add(cb);
      return () => watchers.delete(cb);
    },
    close() {
      for (const e of topics.values()) void client.removeChannel(e.channel);
      topics.clear();
      emit();
    },
  };
}
