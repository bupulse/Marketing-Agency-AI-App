"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { MailCheck } from "lucide-react";
import { confirmEmailCode } from "@/app/signup/actions";
import { EmailCodeForm } from "./email-code-form";
import { ResendButton } from "./resend-button";

/** Shown after sign-up: confirm the address by typing the emailed code, or by opening the link in the same email. */
export function ConfirmEmail({ email, onChangeEmail, next }: { email: string; onChangeEmail?: () => void; next?: string }) {
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
        We sent a code and a link to <strong className="break-all text-text">{email}</strong> from{" "}
        <strong className="text-text">register@bupulse.com</strong>. Type the code here, or open the link. Then choose a plan and book your free demo.
      </p>
      <EmailCodeForm action={confirmEmailCode} email={email} next={next} />
      <p className="text-[13px] text-muted">Can&apos;t find it? Check your spam or promotions folder.</p>
      <ResendButton email={email} startCooldown next={next} />
      <div className="flex flex-col items-center gap-1 text-sm">
        {onChangeEmail && (
          <button type="button" onClick={onChangeEmail} className="min-h-11 cursor-pointer font-semibold text-pulse-blue underline">
            Use a different email
          </button>
        )}
        <Link href={next && next !== "/dashboard" ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="inline-flex min-h-11 items-center font-semibold text-pulse-blue underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
