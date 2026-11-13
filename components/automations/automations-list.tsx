"use client";

import { CalendarCheck, Copy, Gift, MessageCircleQuestion, MoreHorizontal, Pause, Play, Plus, Repeat, Sparkles, Tag, Trash2, Workflow, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy, create, destroy, pause } from "@/app/dashboard/automations/actions";
import { KitStyles } from "@/components/admin/kit/kit-styles";
import { Badge, Button, Dialog, useToast } from "@/components/ui";
import { timeAgo } from "@/components/leads/format";
import { cn } from "@/lib/cn";
import { TEMPLATES } from "@/lib/automations/templates";
import { TRIGGER_LABELS, type TriggerKind } from "@/lib/automations/graph";
import { CHANNEL_LABELS, type ChannelKindValue } from "@/lib/inbox/labels";
import type { AutomationRow } from "@/lib/automations/service";

const STATUS: Record<string, { label: string; tone: "success" | "neutral" | "blue" }> = {
  LIVE: { label: "Live", tone: "success" },
  PAUSED: { label: "Paused", tone: "neutral" },
  DRAFT: { label: "Draft", tone: "blue" },
};

/** A picture for each template card (generic icons). */
const TEMPLATE_ICON: Record<string, LucideIcon> = {
  comment_price: Tag,
  welcome_menu: MessageCircleQuestion,
  book_visit: CalendarCheck,
  ai_answers: Sparkles,
  giveaway: Gift,
  follow_up: Repeat,
};

const CARD = "rounded-[22px] border border-line bg-surface shadow-[0_18px_40px_-34px_rgba(17,24,39,0.5)] dark:bg-white/[0.035] dark:shadow-none";
const LIFT = "transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-pulse-blue/35 hover:shadow-[0_22px_44px_-30px_rgba(47,107,255,0.45)] motion-reduce:transform-none motion-reduce:transition-none";

/** The company's automations as cards: status, what starts it, how often it ran, and the Pause / Duplicate / Delete menu. */
export function AutomationsList({ automations, canEdit }: { automations: AutomationRow[]; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AutomationRow | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

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
    <section aria-labelledby="automations-yours" className="flex flex-col gap-3">
      <KitStyles />
      <h2 id="automations-yours" className="px-1 text-[17px] font-bold tracking-[-0.01em]">
        Your automations
      </h2>
      <ul className="kit-rise grid grid-cols-1 gap-3 md:grid-cols-2">
        {automations.map((a) => (
          <li key={a.id} className={cn("relative flex flex-col gap-3 p-4 sm:p-5", CARD, LIFT)}>
            <div className="flex items-start gap-3">
              <span aria-hidden className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-white", a.status === "LIVE" ? "bg-brand-gradient" : "bg-soft text-muted")}>
                <Workflow className="size-5" />
              </span>
              <Link href={`/dashboard/automations/${a.id}`} className="flex min-w-0 flex-1 flex-col gap-1 text-text no-underline after:absolute after:inset-0 after:rounded-[22px] after:content-['']">
                <span className="truncate text-[16px] font-bold">{a.name}</span>
                <span className="line-clamp-2 text-[13px] text-muted">
                  {a.trigger ? TRIGGER_LABELS[a.trigger as TriggerKind] : "No trigger"}
                  {a.keywords.length ? `: ${a.keywords.slice(0, 4).join(", ")}` : ""} · {a.channels.map((c) => CHANNEL_LABELS[c as ChannelKindValue]).join(", ") || "no channel"}
                </span>
              </Link>
              {canEdit && (
                <div className="relative z-10">
                  <button type="button" aria-label={`More for ${a.name}`} aria-expanded={menu === a.id} onClick={() => setMenu(menu === a.id ? null : a.id)} className="flex size-10 cursor-pointer items-center justify-center rounded-full hover:bg-soft">
                    <MoreHorizontal className="size-5" aria-hidden />
                  </button>
                  {menu === a.id && (
                    <div role="menu" className="glass-strong absolute right-0 top-11 z-20 flex w-48 flex-col rounded-2xl p-1.5 text-[14px]">
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
                      <button
                        role="menuitem"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDeleting(a);
                          setMenu(null);
                        }}
                        className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-red-600 hover:bg-soft"
                      >
                        <Trash2 className="size-4" aria-hidden /> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12.5px] text-muted">
              <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
              {a.changed && <Badge tone="violet">Unpublished changes</Badge>}
              <span>
                <strong className="font-semibold tabular-nums text-text">{a.runs.started}</strong> started · <strong className="font-semibold tabular-nums text-text">{a.runs.finished}</strong> finished
                {a.runs.failed ? ` · ${a.runs.failed} failed` : ""} in 30 days
              </span>
              <span className="ml-auto">changed {timeAgo(a.updatedAt)}</span>
            </div>
          </li>
        ))}
      </ul>

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
    </section>
  );
}

/** "What should it do?": one card per ready template, and a blank one. A tap makes the draft and opens it. */
export function TemplatePicker({ canEdit, socialReady }: { canEdit: boolean; socialReady: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function start(templateKey: string | null) {
    setBusy(templateKey ?? "blank");
    const r = await create(templateKey);
    if (!r.ok) {
      setBusy(null);
      return toast(r.error, "error");
    }
    router.push(`/dashboard/automations/${r.id}`);
  }

  return (
    <section aria-labelledby="automations-templates" className="flex flex-col gap-3">
      <KitStyles />
      <div className="flex flex-col gap-1 px-1">
        <h2 id="automations-templates" className="text-[17px] font-bold tracking-[-0.01em]">
          What should it do?
        </h2>
        <p className="text-[14px] text-muted">Pick one. It is ready to use: change the words and prices, then publish.</p>
      </div>
      <ul className="kit-rise grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TEMPLATES.map((t) => {
          const Icon = TEMPLATE_ICON[t.key] ?? Workflow;
          const needsSocial = t.social && !socialReady;
          return (
            <li key={t.key} className="flex">
              <button
                type="button"
                disabled={!canEdit || busy !== null}
                onClick={() => void start(t.key)}
                className={cn("group flex w-full cursor-pointer flex-col items-start gap-2.5 p-4 text-left text-text disabled:cursor-default sm:p-5", CARD, canEdit && LIFT, busy === t.key && "border-pulse-blue ring-2 ring-pulse-blue/30")}
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-[0_8px_18px_-10px_rgba(85,99,255,0.9)]">
                    <Icon className="size-5" />
                  </span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {t.channels.map((c) => (
                      <Badge key={c} tone="neutral">
                        {CHANNEL_LABELS[c]}
                      </Badge>
                    ))}
                  </span>
                </span>
                <span className="text-[16px] font-bold leading-snug">{t.name}</span>
                <span className="flex-1 text-[13.5px] leading-snug text-muted">{t.description}</span>
                <span className="text-[12.5px] text-muted">Best for: {t.bestFor}</span>
                {needsSocial && <span className="text-[12.5px] text-amber-700 dark:text-amber-300">Needs an Instagram or Facebook account with “Answer comments and messages” on (Channels).</span>}
                {canEdit && <span className="pt-1 text-[13.5px] font-semibold text-pulse-blue">{busy === t.key ? "Making it…" : "Use this"}</span>}
              </button>
            </li>
          );
        })}
        {canEdit && (
          <li className="flex">
            <button type="button" disabled={busy !== null} onClick={() => void start(null)} className={cn("flex w-full cursor-pointer flex-col items-start gap-2.5 border-dashed p-4 text-left text-text sm:p-5", CARD, LIFT)}>
              <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-xl bg-soft text-muted">
                <Plus className="size-5" />
              </span>
              <span className="text-[16px] font-bold">Start from scratch</span>
              <span className="flex-1 text-[13.5px] text-muted">An empty canvas with a trigger. Add the steps you need.</span>
              <span className="pt-1 text-[13.5px] font-semibold text-pulse-blue">{busy === "blank" ? "Making it…" : "Blank automation"}</span>
            </button>
          </li>
        )}
      </ul>
      {!canEdit && <p className="px-1 text-[13px] text-muted">Ask your company owner or an admin to create and change automations.</p>}
    </section>
  );
}
