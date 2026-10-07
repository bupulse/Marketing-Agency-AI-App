"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { Button, Select, useToast } from "@/components/ui";
import { setTimezoneAction } from "@/app/dashboard/calendar/actions";
import { allZones, browserZone } from "./helpers";

const noSubscribe = () => () => {};

/** Picks the business's time zone (defaulting to the browser's) and saves it. */
export function TimezoneForm({ current, onSaved, label = "Save time zone" }: { current: string; onSaved?: () => void; label?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  // The zone list and the browser's zone differ between the server (Node) and each browser, so the
  // server render (and hydration) shows only the saved zone; the browser then fills in the rest.
  const guess = useSyncExternalStore(noSubscribe, browserZone, () => null);
  const zones = useMemo(
    () => (guess === null ? [current] : [...new Set([guess, current, ...allZones()])].filter(Boolean)),
    [guess, current],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const zone = picked ?? (current === "UTC" && guess ? guess : current);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setTimezoneAction(zone);
      if (!res.ok) return setError(res.error);
      toast(`Time zone set to ${zone}.`, "success");
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-sm">
        <label htmlFor="tz-pick" className="text-[13px] font-medium text-muted">Time zone</label>
        <Select id="tz-pick" value={zone} onChange={(e) => setPicked(e.target.value)}>
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
        </Select>
      </div>
      <Button size="sm" onClick={save} disabled={pending} leading={<Globe aria-hidden className="size-4" />}>{pending ? "Saving..." : label}</Button>
      {error && <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>}
    </div>
  );
}
