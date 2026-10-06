"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { MailCheck } from "lucide-react";
import { ResendButton } from "./resend-button";

/** Shown after sign-up: tells people to confirm their address. */
export function ConfirmEmail({ email, onChangeEmail }: { email: string; onChangeEmail?: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-bg">
        <MailCheck aria-hidden className="size-7 text-success" />
      </span>
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-[-0.03em] outline-none focus-visible:outline-none">
        Confirm your email
      </h1>
      <p className="text-[15px] text-muted">
        We sent a confirmation link to <strong className="break-all text-text">{email}</strong>. It comes from{" "}
        <strong className="text-text">register@bupulse.com</strong>. Open it to activate your account and start your free trial.
      </p>
      <p className="text-[13px] text-muted">Can&apos;t find it? Check your spam or promotions folder.</p>
      <ResendButton email={email} startCooldown />
      <div className="flex flex-col items-center gap-1 text-sm">
        {onChangeEmail && (
          <button type="button" onClick={onChangeEmail} className="min-h-11 cursor-pointer font-semibold text-pulse-blue underline">
            Use a different email
          </button>
        )}
        <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-pulse-blue underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
