"use client";

import { CheckCircle2, Copy, Loader2, Smartphone, XCircle } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, GlassCard, Input, Select, useToast } from "@/components/ui";
import { cancelMomoPayment, momoPaymentStatus, startMomoPayment, submitMomoProof } from "@/app/dashboard/billing/actions";
import { formatMomoAmount, MOMO_NETWORKS, NETWORK_LABEL, proofSchema, type ManualPaymentView, type MomoPayDetails } from "@/lib/billing/momo-shared";
import { formatDate, intervalWord } from "./helpers";

const POLL_MS = 5000;

type Props = {
  payment: ManualPaymentView;
  details: MomoPayDetails;
};

/**
 * The Mobile Money card on the Billing page, in the state the payment is in:
 * 1. started: the amount, where to pay, the reference and three steps, then "I've paid";
 * 2. the form for the transaction id and the phone paid from;
 * 3. waiting for BuPulse to confirm (polls every few seconds and refreshes the page when decided);
 * rejected: the reason and "Try again"; confirmed: a green success.
 */
export function MomoPayment({ payment, details }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<"pay" | "proof">(payment.submitted ? "proof" : "pay");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [transactionId, setTransactionId] = useState(payment.transactionId ?? "");
  const [payerPhone, setPayerPhone] = useState(payment.payerPhone ?? "");
  const [network, setNetwork] = useState<string>(payment.network ?? "MTN");
  const waiting = payment.status === "pending" && payment.submitted;
  const announced = useRef(false);

  // Waiting for approval: ask for the payment's status every few seconds; the page re-renders once it is decided.
  useEffect(() => {
    if (!waiting) return;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const now = await momoPaymentStatus();
        if (!now || now.id !== payment.id || now.status !== "pending") {
          clearInterval(timer);
          if (now?.id === payment.id && now.status === "confirmed" && !announced.current) {
            announced.current = true;
            toast("You are all set. Your plan is active.", "success");
          }
          router.refresh();
        }
      } catch {
        // Network hiccup: try again on the next tick.
      } finally {
        busy = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, payment.id, router, toast]);

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast(`${what} copied.`, "success"),
      () => toast(`Could not copy. ${what}: ${text}`, "error"),
    );
  }

  function submit() {
    const parsed = proofSchema.safeParse({ paymentId: payment.id, transactionId, payerPhone, network });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? "form")] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    start(async () => {
      const result = await submitMomoProof({ paymentId: payment.id, transactionId, payerPhone, network });
      if (result.ok) {
        toast("Thanks. We are checking your payment now.", "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  function cancel() {
    start(async () => {
      const result = await cancelMomoPayment(payment.id);
      if (result.ok) router.refresh();
      else toast(result.error, "error");
    });
  }

  function tryAgain() {
    start(async () => {
      const result = await startMomoPayment({ plan: payment.planKey, interval: payment.interval });
      if (result.ok) router.refresh();
      else toast(result.error, "error");
    });
  }

  const amount = formatMomoAmount(payment.amountMinor, payment.currency);
  const title = `${payment.planName} · ${amount} per ${intervalWord(payment.interval)}`;

  if (payment.status === "confirmed") {
    return (
      <GlassCard role="status" className="flex items-start gap-3 border border-success/40 p-5">
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="flex flex-col gap-1">
          <strong>Your {payment.planName} plan is active</strong>
          <p className="text-sm text-muted">Payment {payment.reference} confirmed{payment.periodEnd ? `. Paid until ${formatDate(payment.periodEnd)}` : ""}.</p>
        </div>
      </GlassCard>
    );
  }

  if (payment.status === "rejected") {
    return (
      <GlassCard role="alert" className="flex flex-col gap-4 border border-danger/40 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <XCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="flex flex-col gap-1">
            <strong>We could not match your payment {payment.reference}</strong>
            <p className="text-sm text-muted">{title}</p>
            <p className="text-[15px]">{payment.rejectReason ?? "The payment did not arrive, or the details did not match."}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={tryAgain} disabled={pending}>
            {pending ? "One moment…" : "Try again"}
          </Button>
          <Button variant="ghost" href="/contact">
            Contact support
          </Button>
        </div>
      </GlassCard>
    );
  }

  if (waiting) {
    return (
      <GlassCard role="status" className="flex items-start gap-3 border border-pulse-blue/30 p-5">
        <Loader2 aria-hidden className="mt-0.5 size-5 shrink-0 animate-spin text-pulse-blue motion-reduce:animate-none" />
        <div className="flex flex-col gap-1">
          <strong>Waiting for approval · usually a few minutes</strong>
          <p className="text-sm text-muted">
            {title}. Reference <span className="font-mono">{payment.reference}</span>, transaction {payment.transactionId}. We are checking it now; this page updates by itself and we also email you.
          </p>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard as="section" aria-labelledby="momo-heading" className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-muted">Pay by Mobile Money</span>
          <strong id="momo-heading" className="text-2xl tracking-[-0.02em]">
            {amount}
          </strong>
          <span className="text-sm text-muted">
            {payment.planName}, billed {payment.interval === "YEAR" ? "yearly" : "every month"}. Nothing renews by itself: we remind you before it ends.
          </span>
        </div>
        <Badge tone="violet">Step {step === "pay" ? "1" : "2"} of 2</Badge>
      </div>

      {step === "pay" ? (
        <>
          <dl className="grid gap-x-6 gap-y-3 rounded-2xl bg-soft p-4 text-[15px] sm:grid-cols-2">
            {details.merchantCode && (
              <Detail label="MoMo Pay code" value={details.merchantCode} onCopy={() => copy(details.merchantCode, "MoMo Pay code")} />
            )}
            {details.momoNumber && <Detail label="MTN MoMo number" value={details.momoNumber} onCopy={() => copy(details.momoNumber, "Number")} />}
            {details.airtelNumber && <Detail label="Airtel Money number" value={details.airtelNumber} onCopy={() => copy(details.airtelNumber, "Number")} />}
            {details.accountName && <Detail label="Account name" value={details.accountName} />}
            <Detail label="Your reference" value={payment.reference} mono onCopy={() => copy(payment.reference, "Reference")} />
            <Detail label="Amount" value={amount} onCopy={() => copy(String(payment.amountMinor), "Amount")} />
          </dl>
          <ol className="flex flex-col gap-2 text-[15px]">
            {[
              `On your phone, send ${amount} to the ${details.merchantCode ? "MoMo Pay code" : "number"} above and put ${payment.reference} as the reference or note.`,
              "Confirm with your PIN and wait for the confirmation message.",
              "Come back here, tap I've paid, and type the transaction id from that message.",
            ].map((text, i) => (
              <li key={text} className="flex items-start gap-3">
                <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <span className="pt-0.5">{text}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setStep("proof")} leading={<Smartphone aria-hidden className="size-4" />}>
              I&apos;ve paid
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={pending}>
              Choose another plan
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <p className="text-sm text-muted">From the confirmation message on your phone. We match it against our Mobile Money account and switch your plan on, usually within a few minutes.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Transaction id" error={errors.transactionId} required>
              <Input name="transactionId" value={transactionId} onChange={(e) => setTransactionId(e.target.value)} autoComplete="off" inputMode="text" placeholder="e.g. 1234567890" />
            </Field>
            <Field label="Phone number you paid from" error={errors.payerPhone} required>
              <Input name="payerPhone" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="078 123 4567" />
            </Field>
            <Field label="Network" error={errors.network} required>
              <Select name="network" value={network} onChange={(e) => setNetwork(e.target.value)}>
                {MOMO_NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {NETWORK_LABEL[n]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send for approval"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep("pay")} disabled={pending}>
              Back
            </Button>
          </div>
        </form>
      )}
    </GlassCard>
  );
}

function Detail({ label, value, mono, onCopy }: { label: string; value: string; mono?: boolean; onCopy?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-[13px] text-muted">{label}</dt>
        <dd className={mono ? "font-mono text-lg font-semibold tracking-wide" : "font-semibold"}>{value}</dd>
      </div>
      {onCopy && (
        <button type="button" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`} className="glass inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full">
          <Copy aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}
