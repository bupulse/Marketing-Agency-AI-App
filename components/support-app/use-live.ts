"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RealtimeEvent } from "@/lib/support/contract";
import { POLL_MS, type LiveStatus } from "@/lib/support/app-client/realtime";
import { useSupportApp } from "./app-context";

/** True while the tab is visible (the visitors feed and its polling stop while it is hidden). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** Re-renders every `ms` (waiting timers, "4 min ago"). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Data that stays fresh: loaded once, again on each matching real-time event (a short pause gathers bursts), and every
 * 15 s while the socket is not live. With `pauseWhenHidden` it unsubscribes and stops asking while the tab is hidden.
 */
export function useLiveQuery<T>(
  load: () => Promise<T>,
  { topics, match, pauseWhenHidden = false, key }: { topics: string[]; match?: (e: RealtimeEvent) => boolean; pauseWhenHidden?: boolean; key: string },
): { data: T | null; error: string | null; reload: () => void; live: LiveStatus } {
  const { hub, fail } = useSupportApp();
  // Results are kept with their key, so a new key (another chat, tab or search) starts from nothing.
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key, data: null, error: null });
  const live = useSyncExternalStore(hub.onStatus, hub.status, () => "down" as const);
  const visible = usePageVisible();
  const active = visible || !pauseWhenHidden;
  const loadRef = useRef(load);
  const matchRef = useRef(match);
  const keyRef = useRef(key);
  useEffect(() => {
    loadRef.current = load;
    matchRef.current = match;
    keyRef.current = key;
  });
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    const forKey = keyRef.current;
    loadRef
      .current()
      .then((d) => {
        if (mine === seq.current) setState({ key: forKey, data: d, error: null });
      })
      .catch((e) => {
        if (mine === seq.current) setState((s) => ({ key: forKey, data: s.key === forKey ? s.data : null, error: fail(e) }));
      });
  }, [fail]);

  const topicKey = topics.join(",");
  useEffect(() => {
    if (!active) return;
    reload();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = hub.subscribe(topicKey ? topicKey.split(",") : [], (e) => {
      if (matchRef.current && !matchRef.current(e)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(reload, 300);
    });
    const poll = setInterval(() => {
      if (hub.status() !== "live") reload();
    }, POLL_MS);
    return () => {
      off();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [active, hub, reload, topicKey, key]);

  const mine = state.key === key;
  return { data: mine ? state.data : null, error: mine ? state.error : null, reload, live };
}
