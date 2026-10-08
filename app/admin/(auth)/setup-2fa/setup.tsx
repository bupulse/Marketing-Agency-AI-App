"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { confirmEnrollCode, confirmEnrollment, sendEnrollCode, startEnrollment, type EnrollState } from "../actions";
import { CodeForm } from "../code-form";

const alertClass = "rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger";

/** Two steps: confirm the email with an emailed code (unless this session just did), then scan and verify. */
export function SetupTwoFactor({ emailConfirmed, email }: { emailConfirmed: boolean; email: string }) {
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [needEmail, setNeedEmail] = useState(!emailConfirmed);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (needEmail) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px]">First, confirm it is you. We email a code to <strong>{email}</strong>; a password alone cannot add an authenticator.</p>
        {error && <p role="alert" className={alertClass}>{error}</p>}
        <Button
          type="button"
          variant={sent ? "outline" : "primary"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await sendEnrollCode();
              setError(r.error ?? null);
              if (!r.error) setSent(true);
            })
          }
        >
          {pending ? "Sending…" : sent ? "Send a new code" : "Email me a code"}
        </Button>
        {sent && <CodeForm action={confirmEnrollCode} label="Confirm email" digits={8} />}
      </div>
    );
  }

  if (!enroll?.factorId) {
    return (
      <div className="flex flex-col gap-4">
        {enroll?.error && <p role="alert" className={alertClass}>{enroll.error}</p>}
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await startEnrollment();
              if (r.needEmail) setNeedEmail(true);
              else setEnroll(r);
            })
          }
          className="w-full"
        >
          {pending ? "Preparing…" : "Show my QR code"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[15px]">
        <li>In your app choose Add account, then scan this code.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex justify-center">
        {/* Data URI from Supabase; a plain img keeps it simple. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enroll.qr} alt="QR code to add BuPulse admin to your authenticator app" width={192} height={192} className="rounded-2xl bg-white p-2" />
      </div>
      <details className="text-sm text-muted">
        <summary className="min-h-11 cursor-pointer py-2.5 font-medium text-text">Can’t scan? Enter the key by hand</summary>
        <code className="mt-1 block break-all rounded-xl bg-soft px-3 py-2 font-mono text-text select-all">{enroll.secret}</code>
      </details>
      <CodeForm action={confirmEnrollment} label="Turn on two-step sign-in" factorId={enroll.factorId} />
    </div>
  );
}
