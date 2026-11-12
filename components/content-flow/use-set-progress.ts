"use client";

// Polls how far the day's shared sets are (daySetProgressAction -> lib/visuals/progress.ts) for the loading screens:
// the Create dialog after Create, the day's set on the content page, and the post cards whose set is still being made.
// Every 2.5 s while a set is being made (10 s after 5 minutes, when only a slow render is left; stops after 30), never
// while the tab is hidden, and not at all once every set is ready or failed. `onSettled` runs when a set finishes, so
// the page can refresh and show the finished pictures and reel.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { daySetProgressAction } from "@/app/dashboard/content/day-actions";
import { fromSetProgress, setSettled, type MakingProgress } from "@/components/visuals/making-progress";
import type { SetProgress } from "@/lib/visuals/progress";

export const POLL_MS = 2_500;
export const SLOW_POLL_MS = 10_000;
export const SLOW_AFTER_MS = 5 * 60_000;
export const STOP_AFTER_MS = 30 * 60_000;

/** Pure: how long to wait before the next look, or null to stop (everything finished, or too long). */
export function nextPollIn(sets: readonly Pick<SetProgress, "ready" | "failed">[] | null, elapsedMs: number): number | null {
  if (sets && sets.length > 0 && sets.every(setSettled)) return null;
  if (elapsedMs >= STOP_AFTER_MS) return null;
  return elapsedMs >= SLOW_AFTER_MS ? SLOW_POLL_MS : POLL_MS;
}

/** The sets' progress by group id (empty until the first answer). Pass no ids to stop. */
export function useSetProgress(groupIds: readonly string[], onSettled?: () => void): Map<string, SetProgress> {
  const key = [...new Set(groupIds)].sort().join(",");
  const [sets, setSets] = useState<Map<string, SetProgress>>(() => new Map());
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    const started = Date.now();
    const finished = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const look = async () => {
      timer = null;
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = setTimeout(look, POLL_MS);
        return;
      }
      // A lost answer (network, server restart) is just another wait.
      const res = await daySetProgressAction(ids).catch(() => null);
      if (stopped) return;
      const list = res?.ok ? res.sets : null;
      if (list) {
        setSets(new Map(list.map((s) => [s.groupId, s])));
        const newlyDone = list.filter((s) => setSettled(s) && !finished.has(s.groupId));
        for (const s of newlyDone) finished.add(s.groupId);
        if (newlyDone.length) settledRef.current?.();
      }
      const wait = nextPollIn(list, Date.now() - started);
      if (wait !== null) timer = setTimeout(look, wait);
    };
    void look();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [key]);

  return key ? sets : EMPTY;
}

const EMPTY = new Map<string, SetProgress>();

/**
 * For post cards (Posts -> Today, a subject's board): the loading screen of each post whose set is still being made
 * (ContentPost.setMaking), by its group. The page refreshes as each set finishes, so the cards get their pictures.
 */
export function useMakingByGroup(posts: readonly { groupId: string | null; setMaking?: boolean }[]): (groupId: string | null) => MakingProgress | null {
  const router = useRouter();
  const sets = useSetProgress(
    posts.flatMap((p) => (p.setMaking && p.groupId ? [p.groupId] : [])),
    () => router.refresh(),
  );
  return (groupId) => {
    const s = groupId ? sets.get(groupId) : undefined;
    return s ? fromSetProgress([s]) : null;
  };
}
