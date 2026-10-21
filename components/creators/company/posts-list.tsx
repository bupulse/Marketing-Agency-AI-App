"use client";

import { Ban, CheckCircle2, CircleDashed, ExternalLink, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { rejectPostAction, rejectSubmissionAction } from "@/app/dashboard/creators/actions";
import { formatCompact, formatShortDate } from "@/components/analytics/format";
import { Badge, Button, Dialog, Field, GlassCard, Textarea, useToast, type BadgeTone } from "@/components/ui";
import { formatAmount, PLATFORM_LABEL, POST_STATUS_LABEL, type Platform } from "@/lib/creators/company-forms";
import type { PostRow } from "@/lib/creators/analytics";

const TONE: Record<string, BadgeTone> = { CHECKING: "blue", TRACKING: "success", FINAL: "success", INVALID: "danger", REMOVED: "danger", REJECTED: "neutral" };
const REJECTABLE = ["CHECKING", "TRACKING", "FINAL"];

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  const Icon = ok === null ? CircleDashed : ok ? CheckCircle2 : XCircle;
  return (
    <span className={ok === false ? "inline-flex items-center gap-1 text-danger" : "inline-flex items-center gap-1 text-muted"}>
      <Icon aria-hidden className="size-4" />
      {label}
      <span className="sr-only">{ok === null ? ": not checked yet" : ok ? ": passed" : ": failed"}</span>
    </span>
  );
}

type Rejecting = { kind: "post" | "submission"; id: string; who: string };

/** Posts of the campaign (or of one creator), with their checks and numbers, and the way to reject one or its hand-in. */
export function PostsList({ campaignId, posts, currency, showCreator = true, earning }: { campaignId: string; posts: (PostRow & { earningNow?: number })[]; currency: string; showCreator?: boolean; /** Per-post pay this period (creator page). */ earning?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [rejecting, setRejecting] = useState<Rejecting | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function reject() {
    if (!rejecting) return;
    setBusy(true);
    const r = rejecting.kind === "post" ? await rejectPostAction(campaignId, rejecting.id, reason) : await rejectSubmissionAction(campaignId, rejecting.id, reason);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(rejecting.kind === "post" ? "Post rejected. It earns nothing from now on." : "Hand-in rejected. Its posts earn nothing from now on.", "success");
    setRejecting(null);
    setReason("");
    router.refresh();
  }

  if (posts.length === 0) return <GlassCard className="p-6 text-center text-[15px] text-muted">No posts yet. They show here as soon as creators hand in their tasks.</GlassCard>;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {posts.map((p) => (
          <li key={p.id}>
            <GlassCard className="flex flex-col gap-2.5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                    {showCreator ? (
                      <Link href={`/dashboard/creators/${campaignId}/creators/${p.creatorId}`} className="hover:underline">
                        {p.creator}
                      </Link>
                    ) : (
                      p.submission.task
                    )}
                    <Badge tone={TONE[p.status] ?? "neutral"}>{POST_STATUS_LABEL[p.status] ?? p.status}</Badge>
                    {p.submission.status === "REJECTED" && p.status !== "REJECTED" && <Badge tone="neutral">Hand-in rejected</Badge>}
                  </p>
                  <p className="text-[13px] text-muted">
                    {PLATFORM_LABEL[p.network as Platform] ?? p.network} · {showCreator ? `${p.submission.task} · ` : ""}for {formatShortDate(p.submission.day)}
                    {p.postedAt ? ` · posted ${new Date(p.postedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                  </p>
                </div>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-[14px] font-medium text-[color:var(--bp-link)] hover:bg-soft">
                  Open <ExternalLink aria-hidden className="size-3.5" />
                  <span className="sr-only">(opens the post in a new tab)</span>
                </a>
              </div>
              {p.reason && <p className="rounded-xl bg-soft px-3 py-2 text-[14px]">{p.reason}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <Check ok={p.checks.ownAccount} label="Own account" />
                <Check ok={p.checks.onTime} label="On time" />
                <Check ok={p.checks.mention} label="Mention" />
              </div>
              <dl className="grid grid-cols-3 gap-2 text-[13px] sm:grid-cols-6">
                {[
                  ["Views", p.views],
                  ["Reached", p.impressions],
                  ["Likes", p.likes],
                  ["Comments", p.comments],
                  ["Shares", p.shares],
                ].map(([label, n]) => (
                  <div key={label as string}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-semibold tabular-nums">{formatCompact(n as number)}</dd>
                  </div>
                ))}
                {earning && (
                  <div>
                    <dt className="text-muted">This period</dt>
                    <dd className="font-semibold tabular-nums">{formatAmount(p.earningNow ?? 0, currency)}</dd>
                  </div>
                )}
              </dl>
              {REJECTABLE.includes(p.status) && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" leading={<Ban aria-hidden className="size-4" />} onClick={() => setRejecting({ kind: "post", id: p.id, who: p.creator })}>
                    Reject post
                  </Button>
                  {p.submission.status !== "REJECTED" && (
                    <Button size="sm" variant="outline" onClick={() => setRejecting({ kind: "submission", id: p.submission.id, who: p.creator })}>
                      Reject the whole hand-in
                    </Button>
                  )}
                </div>
              )}
            </GlassCard>
          </li>
        ))}
      </ul>
      <Dialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={rejecting?.kind === "submission" ? "Reject this hand-in?" : "Reject this post?"}
        description={`It earns nothing from now on, like a removed post: its pay is taken out of payouts not paid yet, and pay already paid for it comes off ${rejecting?.who ?? "the creator"}'s next payout.`}
      >
        <div className="mt-2 flex flex-col gap-3">
          <Field label="Why" required hint="The creator sees this.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="The video shows another brand's drink." />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || reason.trim().length < 3} onClick={reject}>
              {busy ? "One moment…" : "Reject"}
            </Button>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Keep it
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
