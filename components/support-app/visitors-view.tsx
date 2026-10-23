"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Dialog, Field, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { STAFF_TOPICS, SURFACES, type LiveVisitor, type Surface } from "@/lib/support/contract";
import type { VisitorGroup } from "@/lib/support/app-client/api";
import { HOT_LEAD, SURFACE_NAMES, VISITOR_GROUPS, filterVisitors, minutesOnSite, visitorAction, visitorCounts } from "@/lib/support/app-client/lists";
import { useSupportApp } from "./app-context";
import { useSupportHref } from "./base";
import { useLiveQuery } from "./use-live";

const KIND: Record<LiveVisitor["kind"], string> = { visitor: "Visitor", client: "Client", creator: "Creator" };

function subline(v: LiveVisitor): { text: string; tone?: string } {
  if (v.typing) return { text: `Typing: “${v.typing}”`, tone: "text-new" };
  if (v.group === "waiting") return { text: "Waiting for a person", tone: "font-semibold text-danger" };
  if (v.group === "chatting") return { text: v.kind === "visitor" ? "Chatting" : `${KIND[v.kind]} · chatting` };
  if (v.group === "idle") return { text: "Idle" };
  return { text: v.kind === "visitor" ? "Browsing" : `${KIND[v.kind]} · browsing` };
}

function Score({ v }: { v: LiveVisitor }) {
  if (v.kind !== "visitor") return <span className="text-muted">{KIND[v.kind]}</span>;
  if (v.leadScore == null) return <span className="text-muted">–</span>;
  return v.leadScore >= HOT_LEAD ? <span className="rounded-full bg-new-bg px-2 py-0.5 text-xs font-semibold text-new">{v.leadScore} hot</span> : <span>{v.leadScore}</span>;
}

function Action({ v, onStart }: { v: LiveVisitor; onStart: (v: LiveVisitor) => void }) {
  const href = useSupportHref();
  const action = visitorAction(v);
  if (!action) return null;
  if (action === "start") return <Button size="sm" variant="outline" className="min-h-10 whitespace-nowrap px-3.5 text-[13px]" onClick={() => onStart(v)}>Start chat</Button>;
  return (
    <Link href={`${href("/")}?c=${v.conversationId}`} className="whitespace-nowrap text-[13px] font-semibold text-ok underline-offset-2 hover:underline">
      {action === "open" ? "Open chat" : "Join chat"}
    </Link>
  );
}

function StartChat({ visitor, onClose }: { visitor: LiveVisitor | null; onClose: () => void }) {
  const { api, fail } = useSupportApp();
  const href = useSupportHref();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={!!visitor} onOpenChange={(o) => !o && onClose()} title={visitor ? `Start a chat with ${visitor.name}` : "Start a chat"} description="Your message opens the chat on their screen. Keep it short and friendly.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!visitor) return;
          const text = String(new FormData(e.currentTarget).get("text") ?? "").trim();
          if (!text) return;
          setPending(true);
          try {
            const { conversationId } = await api.inviteVisitor(visitor.visitorId, text);
            onClose();
            router.push(`${href("/")}?c=${conversationId}`);
          } catch (err) {
            toast(fail(err), "error");
          } finally {
            setPending(false);
          }
        }}
      >
        <Field label="Your first message">
          <Textarea name="text" rows={3} maxLength={2000} required defaultValue={visitor?.currentPath?.startsWith("/pricing") ? "Hi! Can I help you choose a plan?" : "Hi! I’m from the BuPulse team. Can I help with anything?"} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Starting…" : "Start chat"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Live visitors: who is on BuPulse now, by group and by part of the site, with Start chat / Join chat. The feed is live
 * while the tab is visible and is dropped while it is hidden (no socket, no polling).
 */
export function VisitorsView() {
  const { api } = useSupportApp();
  const [group, setGroup] = useState<"all" | VisitorGroup>("all");
  const [surface, setSurface] = useState<"all" | Surface>("all");
  const [start, setStart] = useState<LiveVisitor | null>(null);
  const { data, error } = useLiveQuery(() => api.liveVisitors(), { topics: [STAFF_TOPICS.visitors], key: "visitors", pauseWhenHidden: true });
  const items = data?.items ?? [];
  const counts = visitorCounts(items, surface);
  const rows = filterVisitors(items, group, surface);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">Live visitors</h1>
          <p className="text-sm text-muted">{data ? `${items.length} ${items.length === 1 ? "person" : "people"} on BuPulse right now · updates live` : error ?? "Loading…"}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Where</span>
          <select value={surface} onChange={(e) => setSurface(e.target.value as "all" | Surface)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm">
            <option value="all">Everywhere</option>
            {SURFACES.map((s) => <option key={s} value={s}>{SURFACE_NAMES[s]}</option>)}
          </select>
        </label>
      </header>
      <div role="tablist" aria-label="Visitor groups" className="flex gap-2 overflow-x-auto pb-1">
        {VISITOR_GROUPS.map((g) => {
          const on = group === g.value;
          return (
            <button
              key={g.value}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setGroup(g.value)}
              className={cn(
                "min-h-10 shrink-0 cursor-pointer rounded-full border px-3.5 text-sm font-semibold",
                on ? "border-transparent bg-graphite text-white dark:bg-white dark:text-graphite" : g.value === "waiting" && counts.waiting ? "border-danger/35 bg-danger-bg text-danger" : "border-line bg-surface",
              )}
            >
              {g.label} {counts[g.value]}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-[20px] border border-line bg-surface px-4 py-8 text-center text-sm text-muted">{data ? "Nobody in this group right now." : "Loading…"}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((v) => {
              const sub = subline(v);
              return (
                <li key={v.visitId} className={cn("flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-3.5", v.group === "waiting" && "bg-danger-bg/40", v.group === "idle" && "opacity-70")}>
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col">
                      <strong className="truncate text-[15px]">{v.name}</strong>
                      <span className={cn("text-xs text-muted", sub.tone)}>{sub.text}</span>
                    </span>
                    <Action v={v} onStart={setStart} />
                  </span>
                  <span className="break-all text-[13px]">{v.currentPath}</span>
                  <span className="text-xs text-muted">
                    {[v.country, v.city].filter(Boolean).join(" · ")} · {minutesOnSite(v.secondsOnSite)} · {v.pageCount} pages · {v.device ?? "?"} · from {v.referrer ?? "direct"}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto rounded-[20px] border border-line bg-surface md:block">
            <table className="w-full min-w-[1000px] border-collapse text-[13.5px]">
              <thead>
                <tr className="text-left text-xs tracking-[0.03em] text-muted">
                  {["VISITOR", "WHERE", "NOW ON", "PAGES", "ON SITE", "VISITS", "CAME FROM", "DEVICE", "SCORE"].map((h, i) => (
                    <th key={h} scope="col" className={cn("border-b border-line py-3 font-semibold", i === 0 ? "px-4" : "px-2.5")}>{h}</th>
                  ))}
                  <th scope="col" className="border-b border-line px-4 py-3"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const sub = subline(v);
                  const td = "border-b border-line/60 px-2.5 py-3";
                  return (
                    <tr key={v.visitId} className={cn(v.group === "waiting" && "bg-danger-bg/40", v.group === "idle" && "text-muted")}>
                      <td className="border-b border-line/60 px-4 py-3">
                        <span className="flex flex-col"><strong>{v.name}</strong><span className={cn("text-xs text-muted", sub.tone)}>{sub.text}</span></span>
                      </td>
                      <td className={td}>{[v.country, v.city].filter(Boolean).join(" · ") || "–"}</td>
                      <td className={cn(td, "max-w-[220px] truncate")} title={v.currentPath ?? undefined}>{v.currentPath ?? "–"}</td>
                      <td className={td}>{v.pageCount}</td>
                      <td className={td}>{minutesOnSite(v.secondsOnSite)}</td>
                      <td className={td}>{v.visitCount}</td>
                      <td className={td}>{v.referrer ?? "direct"}</td>
                      <td className={td}>{[v.device, v.browser].filter(Boolean).join(" · ") || "–"}</td>
                      <td className={td}><Score v={v} /></td>
                      <td className="border-b border-line/60 px-4 py-3 text-right"><Action v={v} onStart={setStart} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-[12.5px] text-muted">Locations are approximate. IP addresses are kept 30 days, then only the country.</p>
      <StartChat visitor={start} onClose={() => setStart(null)} />
    </main>
  );
}
