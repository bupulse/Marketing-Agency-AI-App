"use client";

import { Download, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { changeStatus, removeLeads } from "@/app/dashboard/leads/actions";
import { Badge, Button, Dialog, GlassCard, Input, Select, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { LEAD_STATUSES, STATUS_LABELS, sourceLabel, type LeadFilters, type LeadStatusValue } from "@/lib/leads/filters";
import { STATUS_TONE, timeAgo, type InboxLead } from "./format";
import { LeadPanel } from "./lead-panel";

type Props = {
  leads: InboxLead[];
  total: number;
  hasMore: boolean;
  limit: number;
  counts: Record<LeadStatusValue | "ALL", number>;
  sources: string[];
  filters: LeadFilters;
  initialOpenId: string | null;
  /** Without website chat in the plan: leads can be looked at, exported and deleted, but not worked (status, notes). */
  readOnly?: boolean;
};

/** The inbox: filters, list, bulk actions and the detail panel. The URL holds the filters, so links and the CSV export match. */
export function LeadsInbox({ leads: initial, total, hasMore, limit, counts, sources, filters, initialOpenId, readOnly = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();
  const [, startNav] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [leads, setLeads] = useState(initial);
  const [seen, setSeen] = useState(initial);
  // New data from the server (filters, refresh) replaces the local copy.
  if (seen !== initial) {
    setSeen(initial);
    setLeads(initial);
    setSelected(new Set());
  }
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(filters.q ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = leads.find((l) => l.id === openId) ?? null;

  function navigate(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    if (!("limit" in next)) sp.delete("limit");
    startNav(() => router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false }));
  }

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  function onSearch(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => navigate({ q: value.trim() || null }), 350);
  }

  function setStatusLocal(id: string, status: LeadStatusValue) {
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, status } : l)));
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function bulkStatus(status: LeadStatusValue) {
    const ids = [...selected];
    setBusy(true);
    const result = await changeStatus(ids, status);
    setBusy(false);
    if (!result.ok) return toast(result.error, "error");
    setLeads((cur) => cur.map((l) => (selected.has(l.id) ? { ...l, status } : l)));
    setSelected(new Set());
    toast(`${result.changed} ${result.changed === 1 ? "lead" : "leads"} marked ${STATUS_LABELS[status].toLowerCase()}.`, "success");
    router.refresh();
  }

  async function bulkDelete() {
    const ids = [...selected];
    setBusy(true);
    const result = await removeLeads(ids);
    setBusy(false);
    setConfirmDelete(false);
    if (!result.ok) return toast(result.error, "error");
    setLeads((cur) => cur.filter((l) => !selected.has(l.id)));
    if (openId && selected.has(openId)) setOpenId(null);
    setSelected(new Set());
    toast(`${result.deleted} ${result.deleted === 1 ? "lead" : "leads"} deleted.`, "success");
    router.refresh();
  }

  const exportQuery = new URLSearchParams(
    Object.entries({ status: filters.status, source: filters.source, q: filters.q }).filter(([, v]) => v) as [string, string][],
  ).toString();
  const filtered = Boolean(filters.status || filters.source || filters.q);
  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));

  return (
    <div className="flex flex-col gap-4">
      <GlassCard className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
            <Input type="search" aria-label="Search leads" placeholder="Search name, email, phone, interest" value={query} onChange={(e) => onSearch(e.target.value)} className="pl-10" />
          </div>
          {sources.length > 1 && (
            <div className="w-44 max-w-full">
              <Select aria-label="Source" value={filters.source ?? ""} onChange={(e) => navigate({ source: e.target.value || null })}>
                <option value="">All sources</option>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {sourceLabel(s)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Button variant="outline" size="sm" href={`/api/leads/export${exportQuery ? `?${exportQuery}` : ""}`} leading={<Download aria-hidden className="size-4" />} download>
            Export CSV
          </Button>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Status">
          {(["ALL", ...LEAD_STATUSES] as const).map((s) => {
            const active = (filters.status ?? "ALL") === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => navigate({ status: s === "ALL" ? null : s })}
                className={cn(
                  "inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-[14px] font-medium whitespace-nowrap transition-colors",
                  active ? "border-transparent bg-brand-gradient text-white" : "border-line text-text hover:bg-soft",
                )}
              >
                {s === "ALL" ? "All" : STATUS_LABELS[s]}
                <span className={cn("text-[12px]", active ? "text-white/80" : "text-muted")}>{counts[s]}</span>
              </button>
            );
          })}
        </div>
      </GlassCard>

      {selected.size > 0 && (
        <GlassCard strong className="sticky top-2 z-10 flex flex-wrap items-center gap-2 p-3" role="region" aria-label="Bulk actions">
          <span className="px-2 text-[14px] font-semibold">{selected.size} selected</span>
          {!readOnly && (
            <div className="w-40">
              <Select aria-label="Change status of selected" value="" disabled={busy} onChange={(e) => e.target.value && void bulkStatus(e.target.value as LeadStatusValue)}>
                <option value="">Mark as…</option>
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Button variant="outline" size="sm" leading={<Trash2 aria-hidden className="size-4" />} onClick={() => setConfirmDelete(true)} disabled={busy}>
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </GlassCard>
      )}

      <div className={cn("grid items-start gap-4", open && "lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]")}>
        <GlassCard as="section" aria-label="Leads" className="flex min-w-0 flex-col p-2 sm:p-3">
          {leads.length === 0 ? (
            <p className="px-3 py-10 text-center text-[15px] text-muted">
              {filtered ? "No leads match these filters." : "No leads yet."}{" "}
              {filtered && (
                <Link href={pathname} className="font-medium text-pulse-blue hover:underline">
                  Clear filters
                </Link>
              )}
            </p>
          ) : (
            <>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-[13px] text-muted">
                <input
                  type="checkbox"
                  className="size-5 cursor-pointer accent-[var(--color-pulse-blue)]"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)))}
                />
                Select all ({leads.length} of {total})
              </label>
              <ul className="flex flex-col">
                {leads.map((l) => {
                  const contact = [l.email, l.phone].filter(Boolean).join(" · ") || "No contact details";
                  const what = l.interest ?? l.message;
                  return (
                    <li key={l.id} className={cn("flex items-stretch gap-1 rounded-2xl", l.id === openId ? "bg-soft" : "hover:bg-soft")}>
                      <label className="flex w-11 shrink-0 cursor-pointer items-center justify-center">
                        <span className="sr-only">Select {l.name ?? "lead"}</span>
                        <input type="checkbox" className="size-5 cursor-pointer accent-[var(--color-pulse-blue)]" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                      </label>
                      <button type="button" onClick={() => setOpenId(l.id)} aria-current={l.id === openId} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pr-3 text-left">
                        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", l.status === "NEW" ? "bg-pulse-blue" : "bg-transparent")} />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-baseline gap-2">
                            <strong className={cn("truncate text-[15px]", l.status === "NEW" ? "font-bold" : "font-medium")}>{l.name ?? "Visitor"}</strong>
                            <span className="ml-auto shrink-0 text-[12px] text-muted" suppressHydrationWarning>
                              {timeAgo(l.createdAt)}
                            </span>
                          </span>
                          <span className="truncate text-[13px] text-muted">{contact}</span>
                          {what && <span className="truncate text-[13px]">{what}</span>}
                          <span className="mt-1 flex items-center gap-2">
                            <Badge tone={STATUS_TONE[l.status]}>{STATUS_LABELS[l.status]}</Badge>
                            <span className="truncate text-[12px] text-muted">{sourceLabel(l.source)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hasMore && (
                <div className="flex justify-center p-3">
                  <Button variant="outline" size="sm" onClick={() => navigate({ limit: String(limit + 50) })}>
                    Show more
                  </Button>
                </div>
              )}
            </>
          )}
        </GlassCard>

        {open && (
          <aside
            aria-label="Lead details"
            className="fixed inset-0 z-50 bg-surface lg:glass-strong overflow-y-auto overscroll-contain p-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:sticky lg:top-4 lg:z-auto lg:max-h-[calc(100dvh-2rem)] lg:rounded-glass lg:p-6"
          >
            <LeadPanel key={open.id} lead={open} readOnly={readOnly} onClose={() => setOpenId(null)} onStatus={setStatusLocal} />
          </aside>
        )}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${selected.size} ${selected.size === 1 ? "lead" : "leads"}?`} description="This removes them and their notes for good. The chat itself is kept.">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button onClick={() => void bulkDelete()} disabled={busy}>
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
