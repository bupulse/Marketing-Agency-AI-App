"use client";

import Link from "next/link";
import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ACTIVITY_GROUPS, ACTIVITY_LABELS, POLL_MS, pollDelay, type ActivityGroup, type ActivityItem, type ActivityPage } from "@/lib/admin/activity-shared";

const MAX_ITEMS = 300;

const tone = { good: "success", bad: "danger", neutral: "neutral" } as const;

function Row({ item }: { item: ActivityItem }) {
  const when = new Date(item.at);
  const body = (
    <>
      <span className="w-[4.5rem] shrink-0 text-xs tabular-nums text-muted" suppressHydrationWarning title={when.toISOString()}>
        {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <Badge tone={tone[item.tone]} className="shrink-0">{ACTIVITY_LABELS[item.group]}</Badge>
      <span className="min-w-0 basis-full break-words text-[14px] sm:basis-0 sm:flex-1">
        <span className="font-medium">{item.title}</span>
        {item.detail && <span className="text-muted"> · {item.detail}</span>}
        {item.who && <span className="block truncate text-xs text-muted">{item.who}</span>}
      </span>
    </>
  );
  return (
    <li className="border-t border-line first:border-t-0">
      {item.href ? (
        <Link href={item.href} className="flex min-h-11 flex-wrap items-start gap-x-3 gap-y-1 py-2.5 no-underline hover:bg-soft sm:flex-nowrap">{body}</Link>
      ) : (
        <div className="flex min-h-11 flex-wrap items-start gap-x-3 gap-y-1 py-2.5 sm:flex-nowrap">{body}</div>
      )}
    </li>
  );
}

/**
 * The live feed. Polls /admin/activity/feed every 5 seconds with the newest cursor (no websockets, so it works on
 * Workers), stops while paused or while the tab is hidden, and loads older rows on request.
 */
export function ActivityFeed({ initial, compact = false, limit = 40 }: { initial: ActivityPage; compact?: boolean; limit?: number }) {
  const [items, setItems] = useState(initial.items);
  const [newest, setNewest] = useState(initial.newest);
  const [older, setOlder] = useState(initial.nextBefore);
  const [paused, setPaused] = useState(false);
  const [types, setTypes] = useState<ActivityGroup[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  const typesParam = types.join(",");

  const fetchPage = useCallback(async (params: Record<string, string>) => {
    const qs = new URLSearchParams({ limit: String(limit), ...(typesParam ? { types: typesParam } : {}), ...params });
    const res = await fetch(`/admin/activity/feed?${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as ActivityPage;
  }, [limit, typesParam]);

  // A new filter starts the list again.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let live = true;
    fetchPage({})
      .then((p) => {
        if (!live) return;
        setItems(p.items);
        setNewest(p.newest);
        setOlder(p.nextBefore);
        setError(false);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [fetchPage]);

  const newestRef = useRef(newest);
  useEffect(() => {
    newestRef.current = newest;
  }, [newest]);
  const lastNewAt = useRef(0);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (lastNewAt.current === 0) lastNewAt.current = Date.now();
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          // A burst arrives oldest-first in batches: keep asking until the server says it has caught up.
          let cursor = newestRef.current ?? `${Date.now() - 10_000}~`;
          for (let guard = 0; guard < 20 && !stopped; guard++) {
            const p = await fetchPage({ after: cursor });
            setError(false);
            if (p.items.length) {
              lastNewAt.current = Date.now();
              setItems((cur) => {
                const seen = new Set(cur.map((i) => i.id));
                return [...p.items.filter((i) => !seen.has(i.id)), ...cur].slice(0, MAX_ITEMS);
              });
            }
            if (p.newest) {
              cursor = p.newest;
              newestRef.current = p.newest;
              setNewest(p.newest);
            }
            if (!p.more) break;
          }
        } catch {
          setError(true);
        }
      }
      if (!stopped) timer = setTimeout(tick, pollDelay(lastNewAt.current, Date.now()));
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [paused, fetchPage]);

  const loadOlder = async () => {
    if (!older || loading) return;
    setLoading(true);
    try {
      const p = await fetchPage({ before: older });
      setItems((cur) => [...cur, ...p.items.filter((i) => !cur.some((c) => c.id === i.id))]);
      setOlder(p.nextBefore);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setPaused((p) => !p)} leading={paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <span role="status" className="text-xs text-muted">{error ? "Reconnecting…" : paused ? "Paused" : "Live, updates every 5 seconds (slower when quiet)"}</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show only">
            {ACTIVITY_GROUPS.map((g) => {
              const on = types.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTypes((t) => (on ? t.filter((x) => x !== g) : [...t, g]))}
                  className={cn("min-h-11 cursor-pointer rounded-full px-3.5 text-sm font-medium", on ? "bg-brand-gradient text-white" : "bg-soft text-muted hover:text-text")}
                >
                  {ACTIVITY_LABELS[g]}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <p className="rounded-2xl bg-soft px-4 py-6 text-center text-[15px] text-muted">{types.length ? "Nothing of that kind yet. New items appear here as they happen." : "Nothing has happened yet. Sign-ups, posts, payments and errors appear here as they happen."}</p>
      ) : (
        <ul aria-live={compact ? undefined : "off"}>{items.map((i) => <Row key={i.id} item={i} />)}</ul>
      )}
      {!compact && older && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={loadOlder} disabled={loading}>{loading ? "Loading…" : "Older"}</Button>
      )}
    </div>
  );
}
