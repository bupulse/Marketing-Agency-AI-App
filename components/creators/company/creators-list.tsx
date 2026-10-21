"use client";

import { ChevronRight, UserMinus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { removeCreatorAction } from "@/app/dashboard/creators/actions";
import { formatCompact } from "@/components/analytics/format";
import { Badge, Button, Dialog, GlassCard, useToast } from "@/components/ui";
import { formatAmount, PLATFORM_LABEL, type Platform } from "@/lib/creators/company-forms";
import type { CreatorTotalsRow } from "@/lib/creators/analytics";
import { ReportCreator } from "./report-creator";

/** The creators who joined, with their totals; removing one stops their hand-ins. */
export function CreatorsList({ campaignId, rows, currency }: { campaignId: string; rows: CreatorTotalsRow[]; currency: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [removing, setRemoving] = useState<CreatorTotalsRow | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (n: number) => formatAmount(n, currency);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    const r = await removeCreatorAction(campaignId, removing.id);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(`${removing.name} is out of the campaign.`, "success");
    setRemoving(null);
    router.refresh();
  }

  if (rows.length === 0) return <GlassCard className="p-6 text-center text-[15px] text-muted">Nobody has joined yet. Pick applicants on the Applicants tab: they join with the link you send them.</GlassCard>;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.id}>
            <GlassCard className="flex flex-wrap items-center gap-3 p-4">
              <Link href={`/dashboard/creators/${campaignId}/creators/${r.id}`} className="flex min-w-[12rem] flex-1 flex-col gap-1 no-underline">
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  {r.name}
                  {r.status === "REMOVED" && <Badge tone="neutral">Removed</Badge>}
                </span>
                <span className="text-[13px] text-muted">{r.handles.map((h) => `${PLATFORM_LABEL[h.network as Platform] ?? h.network} ${h.handle.startsWith("@") ? h.handle : `@${h.handle}`}`).join(" · ") || r.email}</span>
                <span className="text-[13px] tabular-nums">
                  {r.posts} {r.posts === 1 ? "post" : "posts"} · {formatCompact(r.views)} views · {money(r.earningNow)} this period
                  {r.due ? ` · ${money(r.due)} to pay` : ""}
                  {r.paid ? ` · ${money(r.paid)} paid` : ""}
                </span>
              </Link>
              {r.status === "JOINED" && (
                <Button size="sm" variant="outline" leading={<UserMinus aria-hidden className="size-4" />} onClick={() => setRemoving(r)}>
                  Remove
                </Button>
              )}
              {r.profileId && <ReportCreator profileId={r.profileId} name={r.name} />}
              <ChevronRight aria-hidden className="size-5 text-muted" />
            </GlassCard>
          </li>
        ))}
      </ul>
      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)} title={`Remove ${removing?.name ?? "this creator"}?`} description="They can no longer hand in. Posts they already handed in keep what they earn this period (reject a post to take that away), and payouts already written stay theirs.">
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={remove}>Remove</Button>
          <Button variant="outline" onClick={() => setRemoving(null)}>Keep them</Button>
        </div>
      </Dialog>
    </>
  );
}
