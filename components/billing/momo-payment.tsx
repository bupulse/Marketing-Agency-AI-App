"use client";

import { CheckCircle2, Copy, ImageUp, Loader2, Phone, Smartphone, XCircle } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, GlassCard, Input, Select, useToast } from "@/components/ui";
import { cancelMomoPayment, momoPaymentStatus, startMomoPayment, startMomoProofUpload, submitMomoProof } from "@/app/dashboard/billing/actions";
import { formatMomoAmount, MOMO_NETWORKS, mtnMomoPayDial, NETWORK_LABEL, PROOF_BUCKET, PROOF_TYPES, proofFileProblem, proofSchema, ussdHref, type ManualPaymentView, type MomoPayDetails } from "@/lib/billing/momo-shared";
import { scaledSize } from "@/lib/media/rules";
import { createClient } from "@/lib/supabase/client";
import { formatDate, intervalWord } from "./helpers";

const POLL_MS = 5000;

type Props = {
  payment: ManualPaymentView;
  details: MomoPayDetails;
};

/**
 * The Mobile Money card on the Billing page, in the state the payment is in:
 * 1. started: the amount, the reference, "Dial *182*8*1*<code># on your MTN line" (tap to call on a phone), Airtel
 *    instructions when there is an Airtel number, then "I have paid";
 * 2. the form: the network, the transaction id (or "I can't find it"), the phone paid from and a screenshot of the
 *    confirmation message (uploaded straight to a private bucket, checked by the server);
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
  const [noTransactionId, setNoTransactionId] = useState(false);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
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

  async function pickScreenshot(file: File | null) {
    setErrors((e) => ({ ...e, proof: "" }));
    if (!file) return setScreenshot(null);
    setPreparing(true);
    try {
      const ready = await screenshotFile(file);
      const problem = proofFileProblem(ready);
      if (problem) {
        setScreenshot(null);
        setErrors((e) => ({ ...e, proof: problem }));
      } else {
        setScreenshot(ready);
      }
    } finally {
      setPreparing(false);
    }
  }

  function submit() {
    const fields = { paymentId: payment.id, transactionId: noTransactionId ? null : transactionId, noTransactionId, payerPhone, network };
    // The browser checks the form first (the screenshot is only uploaded once everything else is right).
    const parsed = proofSchema.safeParse({ ...fields, proofPath: screenshot ? screenshot.name || "screenshot" : null });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? "form")] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    start(async () => {
      let proofPath: string | null = null;
      if (screenshot) {
        const target = await startMomoProofUpload({ paymentId: payment.id, type: screenshot.type, bytes: screenshot.size });
        if (!target.ok) return toast(target.error, "error");
        const { error } = await createClient().storage.from(PROOF_BUCKET).uploadToSignedUrl(target.path, target.token, screenshot, { contentType: screenshot.type });
        if (error) return toast("The screenshot did not upload. Check your connection and try again.", "error");
        proofPath = target.path;
      }
      const result = await submitMomoProof({ ...fields, proofPath });
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
      const result = await startMomoPayment(payment.invoiceId ? { invoiceId: payment.invoiceId } : { plan: payment.planKey, interval: payment.interval });
      if (result.ok) router.refresh();
      else toast(result.error, "error");
    });
  }

  const amount = formatMomoAmount(payment.amountMinor, payment.currency);
  const dial = mtnMomoPayDial(details.merchantCode);
  const steps = [
    dial
      ? `MTN: dial ${dial}, enter ${amount}, and confirm with your PIN. If you are asked for a reference, use ${payment.reference}.`
      : details.momoNumber
        ? `MTN: send ${amount} to ${details.momoNumber}${details.accountName ? ` (${details.accountName})` : ""} with ${payment.reference} as the reference.`
        : null,
    details.airtelNumber ? `Airtel: dial *182#, choose Send money, send ${amount} to ${details.airtelNumber}${details.accountName ? ` (${details.accountName})` : ""} and put ${payment.reference} as the reference.` : null,
    "Wait for the confirmation message, then tap I have paid: add the transaction id from it and a screenshot.",
  ].filter((x): x is string => Boolean(x));
  const title = payment.invoiceId ? `Invoice ${payment.reference} · ${payment.planName} · ${amount}` : `${payment.planName} · ${amount} per ${intervalWord(payment.interval)}`;

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
            {title}. Reference <span className="font-mono">{payment.reference}</span>, {payment.transactionId ? `transaction ${payment.transactionId}` : "screenshot sent"}. We are checking it now; this page updates by itself and we also email you.
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
            {payment.invoiceId ? `Invoice ${payment.reference}: ${payment.planName}, ${payment.interval === "YEAR" ? "one year" : "one month"}.` : `${payment.planName}, billed ${payment.interval === "YEAR" ? "yearly" : "every month"}.`} Nothing renews by itself: we remind you before it ends.
          </span>
          {payment.periodNote && (
            <span className={payment.periodNote.mode === "replace" ? "text-sm font-medium text-danger" : "text-sm text-muted"}>
              {payment.periodNote.mode === "extend"
                ? `Added after your current period: your plan runs until ${formatDate(payment.periodNote.currentEnd)} and then one more ${intervalWord(payment.interval)}.`
                : `Plan change: this replaces the ${payment.periodNote.daysLeft} ${payment.periodNote.daysLeft === 1 ? "day" : "days"} left on your current plan (until ${formatDate(payment.periodNote.currentEnd)}). The new plan starts as soon as the payment is confirmed.`}
            </span>
          )}
        </div>
        <Badge tone="violet">Step {step === "pay" ? "1" : "2"} of 2</Badge>
      </div>

      {step === "pay" ? (
        <>
          {dial && (
            <div className="flex flex-col gap-3 rounded-2xl border border-pulse-blue/30 p-4">
              <p className="text-[15px]">
                Dial <span className="break-all font-mono text-lg font-semibold tracking-wide">{dial}</span> on your MTN line, enter <strong>{amount}</strong> and confirm with your PIN.
              </p>
              <div className="flex flex-wrap gap-2">
                {/* A tel: link opens the phone's dialer with the code ready; "#" is escaped or the dialer drops it. */}
                <a href={ussdHref(dial)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-gradient px-5 text-sm font-semibold text-white no-underline md:hidden">
                  <Phone aria-hidden className="size-4" /> Tap to dial
                </a>
                <button type="button" onClick={() => copy(dial, "Dial code")} className="glass inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium">
                  <Copy aria-hidden className="size-4" /> Copy dial code
                </button>
              </div>
            </div>
          )}
          <dl className="grid gap-x-6 gap-y-3 rounded-2xl bg-soft p-4 text-[15px] sm:grid-cols-2">
            <Detail label="Amount" value={amount} onCopy={() => copy(String(payment.amountMinor), "Amount")} />
            <Detail label="Your reference" value={payment.reference} mono onCopy={() => copy(payment.reference, "Reference")} />
            {details.merchantCode && <Detail label="MoMo Pay code (MTN)" value={details.merchantCode} onCopy={() => copy(details.merchantCode, "MoMo Pay code")} />}
            {details.momoNumber && <Detail label="MTN MoMo number" value={details.momoNumber} onCopy={() => copy(details.momoNumber, "Number")} />}
            {details.airtelNumber && <Detail label="Airtel Money number" value={details.airtelNumber} onCopy={() => copy(details.airtelNumber, "Number")} />}
            {details.accountName && <Detail label="Account name" value={details.accountName} />}
          </dl>
          <ol className="flex flex-col gap-2 text-[15px]">
            {steps.map((text, i) => (
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
              I have paid
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={pending}>
              {payment.invoiceId ? "Not now" : "Choose another plan"}
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
            <Field label="Network" error={errors.network} required>
              <Select name="network" value={network} onChange={(e) => setNetwork(e.target.value)}>
                {MOMO_NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {NETWORK_LABEL[n]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Phone number you paid from" error={errors.payerPhone} required>
              <Input name="payerPhone" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="078 123 4567" />
            </Field>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Field label="Transaction id" hint="In the confirmation SMS, e.g. “Financial Transaction Id: 1234567890”." error={errors.transactionId} required={!noTransactionId}>
                <Input name="transactionId" value={noTransactionId ? "" : transactionId} onChange={(e) => setTransactionId(e.target.value)} disabled={noTransactionId} autoComplete="off" inputMode="text" placeholder="e.g. 1234567890" />
              </Field>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" checked={noTransactionId} onChange={(e) => setNoTransactionId(e.target.checked)} className="size-5" />
                I can&apos;t find the transaction id (then add the screenshot below)
              </label>
            </div>
            <div className="sm:col-span-2">
              <Field
                label="Screenshot of the confirmation message"
                hint={noTransactionId ? "Required without the transaction id. JPEG, PNG or WebP, up to 5 MB." : "Helps us find your payment faster. JPEG, PNG or WebP, up to 5 MB."}
                error={errors.proof}
                required={noTransactionId}
              >
                <Input type="file" name="screenshot" accept={`${Object.keys(PROOF_TYPES).join(",")},image/heic,image/heif`} onChange={(e) => void pickScreenshot(e.target.files?.[0] ?? null)} />
              </Field>
              {(preparing || screenshot) && (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                  <ImageUp aria-hidden className="size-4" /> {preparing ? "Preparing the screenshot…" : `${screenshot?.name} (${Math.max(1, Math.round((screenshot?.size ?? 0) / 1024))} KB)`}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending || preparing}>
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

/**
 * The screenshot as the server takes it: a JPEG, PNG or WebP up to 5 MB is sent as is; anything else the browser can
 * draw (an iPhone HEIC photo, a huge PNG) is converted to a JPEG, at most 2400 px on its long side. A file the browser
 * cannot read is returned unchanged, and the type check then says what to send instead.
 */
async function screenshotFile(file: File): Promise<File> {
  if (!proofFileProblem(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = scaledSize(bitmap.width, bitmap.height, 2400);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "screenshot"}.jpg`, { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
