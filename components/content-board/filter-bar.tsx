"use client";

import { useOptimistic, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { Button, Chip, Dialog, Input } from "@/components/ui";
import { NetworkIcon } from "@/components/publishing/network-icon";
import { cn } from "@/lib/cn";
import {
  activeFilterCount,
  contentQuery,
  DATE_RANGE_LABEL,
  DATE_RANGES,
  STATUS_FILTER_LABEL,
  STATUS_FILTERS,
  type ContentFilters,
  type DateRange,
  type StatusFilter,
} from "@/lib/content-board/filters";
import { KIND_LABEL, POST_KINDS, type PostKind } from "@/lib/content-board/kind";
import { networkLabel } from "@/lib/content-board/labels";
import { NETWORKS, type Network } from "@/lib/social/types";

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/**
 * The Content page's filters, kept in the URL so a view can be shared: quick status chips inline, and every filter
 * (app, post type, date, status) in a sheet (a bottom sheet on phones). Active filters show as removable chips.
 */
export function FilterBar({ filters, apps = NETWORKS, day }: { filters: ContentFilters; apps?: readonly Network[]; /** The day view's day (content flow v3): kept in the URL, and the date filter is not offered. */ day?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  // The chip a person tapped shows as selected at once; the list follows when the page has loaded the filter.
  const [statuses, setStatuses] = useOptimistic(filters.statuses);
  const count = activeFilterCount(filters);

  function go(next: ContentFilters) {
    const query = contentQuery({ ...next, limit: undefined, ...(day ? { range: undefined } : {}) });
    const withDay = day ? `${query ? `${query}&` : "?"}day=${day}` : query;
    start(() => {
      setStatuses(next.statuses);
      router.push(`${pathname}${withDay}`, { scroll: false });
    });
  }

  const chips: { key: string; label: string; remove: ContentFilters }[] = [
    ...filters.apps.map((a) => ({ key: `app-${a}`, label: networkLabel(a), remove: { ...filters, apps: filters.apps.filter((x) => x !== a) } })),
    ...filters.kinds.map((k) => ({ key: `type-${k}`, label: KIND_LABEL[k], remove: { ...filters, kinds: filters.kinds.filter((x) => x !== k) } })),
    ...(filters.range
      ? [{ key: "range", label: `${filters.dateField === "planned" ? "Scheduled or posted" : "Created"}: ${rangeText(filters)}`, remove: { ...filters, range: undefined, from: undefined, to: undefined } }]
      : []),
    ...(filters.auto ? [{ key: "auto", label: "Auto-scheduled", remove: { ...filters, auto: false } }] : []),
  ];

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Status" className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-1">
          <Chip selected={statuses.length === 0} onClick={() => go({ ...filters, statuses: [] })} className="px-4 py-2 text-[14px]">
            All
          </Chip>
          {STATUS_FILTERS.map((s) => (
            <Chip key={s} selected={statuses.length === 1 && statuses[0] === s} onClick={() => go({ ...filters, statuses: [s] })} className="px-4 py-2 text-[14px]">
              {STATUS_FILTER_LABEL[s]}
            </Chip>
          ))}
        </div>
        {pending && (
          <span role="status" className="text-[13px] text-muted">
            Updating…
          </span>
        )}
        <Button variant="outline" size="sm" className="ml-auto" leading={<SlidersHorizontal aria-hidden className="size-4" />} onClick={() => setOpen(true)} aria-haspopup="dialog">
          Filters{count > 0 ? ` (${count})` : ""}
        </Button>
      </div>

      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => go(c.remove)}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full bg-soft py-1 pr-3 pl-4 text-[14px] font-medium hover:bg-soft/70"
                aria-label={`Remove filter ${c.label}`}
              >
                {c.label}
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => go({ ...filters, apps: [], kinds: [], statuses: [], range: undefined, from: undefined, to: undefined, auto: false })} className="inline-flex min-h-11 cursor-pointer items-center px-3 text-[14px] font-semibold text-pulse-blue">
              Clear all
            </button>
          </li>
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen} title="Filters" className="max-w-xl">
        {open && <FilterSheet initial={filters} apps={apps} dates={!day} onApply={(f) => { setOpen(false); go(f); }} />}
      </Dialog>
    </div>
  );
}

function rangeText(f: ContentFilters): string {
  if (f.range !== "custom") return DATE_RANGE_LABEL[f.range ?? "today"];
  if (f.from && f.to) return f.from === f.to ? f.from : `${f.from} to ${f.to}`;
  return f.from ? `from ${f.from}` : `until ${f.to}`;
}

function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-[13px] font-semibold tracking-wide text-muted uppercase">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function FilterSheet({ initial, apps, dates = true, onApply }: { initial: ContentFilters; apps: readonly Network[]; dates?: boolean; onApply: (f: ContentFilters) => void }) {
  const [f, setF] = useState<ContentFilters>(initial);
  const set = (patch: Partial<ContentFilters>) => setF((prev) => ({ ...prev, ...patch }));

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(f.range === "custom" && !f.from && !f.to ? { ...f, range: undefined } : f);
      }}
    >
      <Group legend="App">
        {apps.map((a) => (
          <Chip key={a} selected={f.apps.includes(a)} onClick={() => set({ apps: toggle(f.apps, a) })} icon={<NetworkIcon network={a} size={20} />} className="px-4 py-2 text-[14px]">
            {networkLabel(a)}
          </Chip>
        ))}
      </Group>

      <Group legend="Post type">
        {POST_KINDS.map((k: PostKind) => (
          <Chip key={k} selected={f.kinds.includes(k)} onClick={() => set({ kinds: toggle(f.kinds, k) })} className="px-4 py-2 text-[14px]">
            {k === "video" ? "Video, Reel or Short" : k === "article" ? "Article" : KIND_LABEL[k]}
          </Chip>
        ))}
      </Group>

      <Group legend="Status">
        {STATUS_FILTERS.map((s: StatusFilter) => (
          <Chip key={s} selected={f.statuses.includes(s)} onClick={() => set({ statuses: toggle(f.statuses, s) })} className="px-4 py-2 text-[14px]">
            {STATUS_FILTER_LABEL[s]}
          </Chip>
        ))}
        <Chip selected={f.auto} onClick={() => set({ auto: !f.auto })} className="px-4 py-2 text-[14px]">
          Auto-scheduled
        </Chip>
      </Group>

      {dates && (
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2.5 text-[13px] font-semibold tracking-wide text-muted uppercase">Date</legend>
        <div role="radiogroup" aria-label="Which date" className="inline-flex w-full rounded-full bg-soft p-1 sm:w-auto">
          {(["created", "planned"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={f.dateField === d}
              onClick={() => set({ dateField: d })}
              className={cn("min-h-11 flex-1 cursor-pointer rounded-full px-4 text-[14px] font-semibold sm:flex-none", f.dateField === d ? "bg-bg text-text shadow-glass" : "text-muted")}
            >
              {d === "created" ? "Created" : "Scheduled or posted"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip selected={!f.range} onClick={() => set({ range: undefined, from: undefined, to: undefined })} className="px-4 py-2 text-[14px]">
            Any time
          </Chip>
          {DATE_RANGES.map((r: DateRange) => (
            <Chip key={r} selected={f.range === r} onClick={() => set({ range: r })} className="px-4 py-2 text-[14px]">
              {DATE_RANGE_LABEL[r]}
            </Chip>
          ))}
        </div>
        {f.range && f.range !== "custom" && f.dateField === "planned" && <p className="text-[13px] text-muted">Shows posts that went out in that time and posts scheduled for the same time ahead.</p>}
        {f.range === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-medium text-muted">
              From
              <Input type="date" value={f.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium text-muted">
              To
              <Input type="date" value={f.to ?? ""} min={f.from} onChange={(e) => set({ to: e.target.value || undefined })} />
            </label>
          </div>
        )}
      </fieldset>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit">Show posts</Button>
        <Button type="button" variant="ghost" onClick={() => setF({ ...f, apps: [], kinds: [], statuses: [], range: undefined, from: undefined, to: undefined, auto: false })}>
          Clear
        </Button>
      </div>
    </form>
  );
}
