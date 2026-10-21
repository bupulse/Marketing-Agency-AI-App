"use client";

import { Check, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markPayoutPaidAction, updatePeriodGoalsAction } from "@/app/dashboard/creators/actions";
import { formatCompact, formatShortDate } from "@/components/analytics/format";
import { Badge, Button, Dialog, Field, GlassCard, Input, useToast } from "@/components/ui";
import { firstProblem, formatAmount, goalsSchema, limitsInWords } from "@/lib/creators/company-forms";
import type { PayoutPeriod } from "@/lib/creators/analytics";

type Line = PayoutPeriod["lines"][number];

const num = (s: string) => {
  const t = s.replace(/[,\s]/g, "");
  return t === "" ? null : Number(t);
};

function GoalsDialog({ campaignId, period, currency, onClose }: { campaignId: string; period: PayoutPeriod | null; currency: string; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [creator, setCreator] = useState(period?.goals.viewTargetPerCreator?.toString() ?? "");
  const [all, setAll] = useState(period?.goals.viewTargetCampaign?.toString() ?? "");
  const [budget, setBudget] = useState(period?.goals.budget?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!period) return;
    const goals = { viewTargetPerCreator: num(creator), viewTargetCampaign: num(all), budget: num(budget) };
    const checked = goalsSchema.safeParse(goals);
    if (!checked.success) return setError(firstProblem(checked.error).replace(/^Invalid input.*$/, "Use whole numbers."));
    setBusy(true);
    const r = await updatePeriodGoalsAction(campaignId, period.id, goals);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast("Goals saved. Pay so far is worked out again with them.", "success");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={period !== null} onOpenChange={(o) => !o && onClose()} title={period ? `Goals of period ${period.index}` : "Goals"} description="Leave a field empty for no limit. Pay so far is worked out again with the new goals.">
      <div className="mt-2 flex flex-col gap-3">
        <Field label="Views per creator">
          <Input inputMode="numeric" value={creator} onChange={(e) => setCreator(e.target.value)} />
        </Field>
        <Field label="Views of all creators">
          <Input inputMode="numeric" value={all} onChange={(e) => setAll(e.target.value)} />
        </Field>
        <Field label={`Budget (${currency})`}>
          <Input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-[14px] font-medium text-danger">{error}</p>}
        <Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save goals"}</Button>
      </div>
    </Dialog>
  );
}

function PaidDialog({ campaignId, line, currency, onClose }: { campaignId: string; line: Line | null; currency: string; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!line?.id) return;
    setBusy(true);
    const r = await markPayoutPaidAction(campaignId, line.id, reference);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast(`Marked paid. ${line.name} sees it as paid.`, "success");
    setReference("");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={line !== null} onOpenChange={(o) => !o && onClose()} title={line ? `Paid ${formatAmount(line.amount, currency)} to ${line.name}?` : "Mark paid"} description={line?.phone ? `Send it by Mobile Money to ${line.phone}, then type the reference from the confirmation message.` : "Send it by Mobile Money, then type the reference from the confirmation message."}>
      <div className="mt-2 flex flex-col gap-3">
        <Field label="Mobile Money reference" required>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} autoCapitalize="characters" placeholder="e.g. 12345678901" />
        </Field>
        {error && <p role="alert" className="text-[14px] font-medium text-danger">{error}</p>}
        <Button disabled={busy || reference.trim().length < 3} onClick={save} leading={<Check aria-hidden className="size-4" />}>
          {busy ? "Saving…" : "Mark paid"}
        </Button>
      </div>
    </Dialog>
  );
}

/** Every pay period: what creators earn so far (open), what to pay and what was paid (closed), and what is coming. */
export function Payouts({ campaignId, periods, currency, ended }: { campaignId: string; periods: PayoutPeriod[]; currency: string; ended: boolean }) {
  const [goals, setGoals] = useState<PayoutPeriod | null>(null);
  const [paying, setPaying] = useState<Line | null>(null);
  const money = (n: number) => formatAmount(n, currency);

  return (
    <div className="flex flex-col gap-4">
      <p className="px-1 text-[14px] text-muted">Each period is paid at its end: BuPulse takes the last reading, writes what each creator earned, and you pay them by Mobile Money. BuPulse never holds the money.</p>
      {periods.map((p) => (
        <GlassCard key={p.id} className="flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              Period {p.index}
              <Badge tone={p.state === "open" ? "success" : p.state === "closed" ? "neutral" : "blue"}>{p.state === "open" ? "Running" : p.state === "closed" ? "Closed" : "Not started"}</Badge>
            </h2>
            <span className="text-[14px] text-muted">
              {formatShortDate(p.startsOn)} to {formatShortDate(p.endsOn)}
            </span>
          </div>
          <p className="text-[14px] text-muted">
            Goals: {p.goals.viewTargetPerCreator ? `${formatCompact(p.goals.viewTargetPerCreator)} views per creator` : "no view limit per creator"} · {p.goals.viewTargetCampaign ? `${formatCompact(p.goals.viewTargetCampaign)} views in all` : "no limit for all"} · {p.goals.budget ? `budget ${money(p.goals.budget)}` : "no budget"}
          </p>
          {p.state !== "closed" && !ended && (
            <Button size="sm" variant="outline" className="self-start" leading={<Target aria-hidden className="size-4" />} onClick={() => setGoals(p)}>
              Change goals
            </Button>
          )}
          {p.state !== "upcoming" && (
            <>
              <p className="text-[15px]">
                <span className="font-semibold">{p.state === "open" ? "Earned so far:" : "Total:"}</span> {money(p.total)}
                {p.state === "open" && <span className="text-muted"> (it can still change until the period closes)</span>}
              </p>
              {p.limitsHit.length > 0 && (
                <ul className="list-disc pl-5 text-[14px] text-muted">
                  {limitsInWords(p.limitsHit).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {p.lines.length === 0 ? (
                <p className="text-[14px] text-muted">{p.state === "open" ? "No views counted yet in this period." : "Nobody earned anything in this period."}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {p.lines.map((l) => (
                    <li key={l.creatorId} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium">{l.name}</span>
                        <span className="text-[13px] text-muted tabular-nums">
                          {formatCompact(l.views)} views, {formatCompact(l.countedViews)} counted
                          {l.deductions ? ` · ${money(l.deductions)} taken back` : ""}
                          {l.stillOwed ? ` · ${money(l.stillOwed)} still owed back` : ""}
                        </span>
                      </span>
                      <span className="text-[15px] font-semibold tabular-nums">{money(l.amount)}</span>
                      {l.status === "DUE" && l.amount > 0 && (
                        <Button size="sm" onClick={() => setPaying(l)}>
                          Mark paid
                        </Button>
                      )}
                      {l.status === "PAID" && <Badge tone="success">Paid{l.reference ? ` · ${l.reference}` : ""}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </GlassCard>
      ))}
      <GoalsDialog key={goals?.id ?? "none"} campaignId={campaignId} period={goals} currency={currency} onClose={() => setGoals(null)} />
      <PaidDialog campaignId={campaignId} line={paying} currency={currency} onClose={() => setPaying(null)} />
    </div>
  );
}
