"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, PenLine, Trash2 } from "lucide-react";
import { Button, Dialog, GlassCard, useToast } from "@/components/ui";

type Outcome = { ok: true } | { ok: false; error: string };

/**
 * A Knowledge base list (personas, competitors, FAQs) as cards in the owner's order: Edit, Delete (confirmed), and
 * Move up / Move down, which send the whole new order (the server refuses a stale one). Read-only without `canEdit`.
 */
export function OrderedList<T extends { id: string }>({
  items,
  label,
  noun,
  title,
  render,
  canEdit,
  onEdit,
  onDelete,
  onReorder,
  sortable = true,
}: {
  items: T[];
  /** The list's accessible name, e.g. "Personas". */
  label: string;
  /** "persona", for the buttons and the delete dialog. */
  noun: string;
  title: (item: T) => string;
  render: (item: T) => ReactNode;
  canEdit: boolean;
  onEdit: (item: T) => void;
  onDelete: (id: string) => Promise<Outcome>;
  onReorder?: (ids: string[]) => Promise<Outcome>;
  sortable?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<T | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const shown = order ? order.flatMap((id) => items.filter((i) => i.id === id)) : items;

  function move(index: number, by: -1 | 1) {
    if (!onReorder) return;
    const ids = shown.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    setOrder(ids);
    start(async () => {
      const result = await onReorder(ids);
      setOrder(null);
      if (!result.ok) return toast(result.error, "error");
      router.refresh();
    });
  }

  return (
    <>
      <ul aria-label={label} className="flex flex-col gap-3">
        {shown.map((item, index) => (
          <li key={item.id}>
            <GlassCard className="flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="min-w-0 flex-1 text-[16px] font-semibold break-words">{title(item)}</h3>
                {canEdit && (
                  <div className="flex flex-wrap gap-1">
                    {sortable && onReorder && shown.length > 1 && (
                      <>
                        <Button variant="ghost" size="sm" disabled={pending || index === 0} aria-label={`Move ${title(item)} up`} onClick={() => move(index, -1)}>
                          <ArrowUp aria-hidden className="size-4" />
                        </Button>
                        <Button variant="ghost" size="sm" disabled={pending || index === shown.length - 1} aria-label={`Move ${title(item)} down`} onClick={() => move(index, 1)}>
                          <ArrowDown aria-hidden className="size-4" />
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" disabled={pending} leading={<PenLine aria-hidden className="size-4" />} onClick={() => onEdit(item)}>
                      Edit<span className="sr-only"> {title(item)}</span>
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} leading={<Trash2 aria-hidden className="size-4" />} onClick={() => setConfirming(item)}>
                      Delete<span className="sr-only"> {title(item)}</span>
                    </Button>
                  </div>
                )}
              </div>
              {render(item)}
            </GlassCard>
          </li>
        ))}
      </ul>
      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)} title={`Delete this ${noun}?`} description={confirming ? `"${title(confirming)}" will be removed. This cannot be undone.` : undefined}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>
            Keep it
          </Button>
          <Button
            disabled={pending}
            leading={<Trash2 aria-hidden className="size-4" />}
            onClick={() =>
              start(async () => {
                if (!confirming) return;
                const result = await onDelete(confirming.id);
                if (!result.ok) return toast(result.error, "error");
                setConfirming(null);
                toast("Deleted.", "success");
                router.refresh();
              })
            }
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** Lines under a heading on a card ("Needs: a, b"), or nothing when empty. */
export function DetailLine({ label, items }: { label: string; items: (string | null | undefined)[] }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <p className="text-[14px]">
      <span className="font-semibold">{label}:</span> <span className="text-muted">{shown.join(" · ")}</span>
    </p>
  );
}
