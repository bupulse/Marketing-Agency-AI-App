"use client";

import { Copy, MoreHorizontal, Pause, Play, Plus, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy, create, destroy, pause } from "@/app/dashboard/automations/actions";
import { Badge, Button, Dialog, GlassCard, useToast } from "@/components/ui";
import { timeAgo } from "@/components/leads/format";
import { TEMPLATES } from "@/lib/automations/templates";
import { TRIGGER_LABELS, type TriggerKind } from "@/lib/automations/graph";
import { CHANNEL_LABELS, type ChannelKindValue } from "@/lib/inbox/labels";
import type { AutomationRow } from "@/lib/automations/service";

const STATUS: Record<string, { label: string; tone: "success" | "neutral" | "blue" }> = {
  LIVE: { label: "Live", tone: "success" },
  PAUSED: { label: "Paused", tone: "neutral" },
  DRAFT: { label: "Draft", tone: "blue" },
};

export function AutomationsList({ automations, canEdit, socialReady }: { automations: AutomationRow[]; canEdit: boolean; socialReady: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AutomationRow | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  async function start(templateKey: string | null) {
    setBusy(true);
    const r = await create(templateKey);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    router.push(`/dashboard/automations/${r.id}`);
  }

  async function run(p: Promise<{ ok: boolean; error?: string; id?: string }>, done: string) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    setMenu(null);
    if (!r.ok) return toast(r.error ?? "Something went wrong.", "error");
    toast(done, "success");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {automations.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[17px] font-semibold">Your automations</h2>
            {canEdit && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => start(null)}>
                <Plus className="size-4" aria-hidden /> Blank automation
              </Button>
            )}
          </div>
          <GlassCard padding="none" className="divide-y divide-line">
            {automations.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/dashboard/automations/${a.id}`} className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold hover:underline">{a.name}</span>
                    <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                    {a.changed && <Badge tone="violet">Unpublished changes</Badge>}
                  </span>
                  <span className="truncate text-[13px] text-muted">
                    {a.trigger ? TRIGGER_LABELS[a.trigger as TriggerKind] : "No trigger"}
                    {a.keywords.length ? `: ${a.keywords.slice(0, 4).join(", ")}` : ""} · {a.channels.map((c) => CHANNEL_LABELS[c as ChannelKindValue]).join(", ") || "no channel"}
                  </span>
                </Link>
                <span className="text-right text-[12px] text-muted">
                  {a.runs.started} started · {a.runs.finished} finished
                  {a.runs.failed ? ` · ${a.runs.failed} failed` : ""}
                  <span className="block">last 30 days · changed {timeAgo(a.updatedAt)}</span>
                </span>
                {canEdit && (
                  <div className="relative">
                    <button type="button" aria-label={`More for ${a.name}`} aria-expanded={menu === a.id} onClick={() => setMenu(menu === a.id ? null : a.id)} className="flex size-9 items-center justify-center rounded-full hover:bg-soft">
                      <MoreHorizontal className="size-5" aria-hidden />
                    </button>
                    {menu === a.id && (
                      <div role="menu" className="glass-strong absolute right-0 top-10 z-10 flex w-48 flex-col rounded-2xl p-1.5 text-[14px]">
                        {a.status === "LIVE" && (
                          <button role="menuitem" type="button" disabled={busy} onClick={() => run(pause(a.id, true), "Paused.")} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-soft">
                            <Pause className="size-4" aria-hidden /> Pause
                          </button>
                        )}
                        {a.status === "PAUSED" && (
                          <button role="menuitem" type="button" disabled={busy} onClick={() => run(pause(a.id, false), "Live again.")} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-soft">
                            <Play className="size-4" aria-hidden /> Resume
                          </button>
                        )}
                        <button role="menuitem" type="button" disabled={busy} onClick={() => run(copy(a.id), "Copied as a draft.")} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-soft">
                          <Copy className="size-4" aria-hidden /> Duplicate
                        </button>
                        <button role="menuitem" type="button" disabled={busy} onClick={() => {
                            setDeleting(a);
                            setMenu(null);
                          }} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-red-600 hover:bg-soft">
                          <Trash2 className="size-4" aria-hidden /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </GlassCard>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="px-1">
          <h2 className="text-[17px] font-semibold">{automations.length ? "Start from a template" : "Start with a template"}</h2>
          <p className="text-[14px] text-muted">Each one is ready to use: change the words and prices, then publish.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {TEMPLATES.map((t) => (
            <GlassCard key={t.key} padding="sm" className="flex flex-col gap-2">
              <span className="flex items-center gap-2">
                <Workflow className="size-4 text-pulse-blue" aria-hidden />
                <span className="text-[15px] font-semibold">{t.name}</span>
              </span>
              <p className="flex-1 text-[14px] text-muted">{t.description}</p>
              <p className="text-[12px] text-muted">
                Best for: {t.bestFor} · {t.channels.map((c) => CHANNEL_LABELS[c]).join(", ")}
              </p>
              {t.social && !socialReady && <p className="text-[12px] text-amber-700">Needs an Instagram or Facebook account with “Answer comments and messages” on (Channels).</p>}
              {canEdit && (
                <div>
                  <Button size="sm" disabled={busy} onClick={() => start(t.key)}>
                    Use this template
                  </Button>
                </div>
              )}
            </GlassCard>
          ))}
          {canEdit && (
            <GlassCard padding="sm" className="flex flex-col items-start gap-2">
              <span className="text-[15px] font-semibold">Start from scratch</span>
              <p className="flex-1 text-[14px] text-muted">An empty canvas with a trigger. Add the steps you need.</p>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => start(null)}>
                <Plus className="size-4" aria-hidden /> Blank automation
              </Button>
            </GlassCard>
          )}
        </div>
        {!canEdit && <p className="px-1 text-[13px] text-muted">Ask your company owner or an admin to create and change automations.</p>}
      </section>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete “${deleting?.name ?? ""}”?`}>
        <p className="text-[14px] text-muted">It stops answering at once, and its history is deleted. Contacts, conversations and leads stay.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={() => deleting && run(destroy(deleting.id), "Deleted.").then(() => setDeleting(null))}>
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
