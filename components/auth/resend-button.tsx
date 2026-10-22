"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { resendConfirmation } from "@/app/signup/actions";

export const RESEND_COOLDOWN_SECONDS = 60;

/** "Resend email" with a 60s client-side cooldown. The server uses supabase.auth.resend({ type: 'signup' }). */
export function ResendButton({ email, startCooldown = false, next }: { email: string; startCooldown?: boolean; next?: string }) {
  const [seconds, setSeconds] = useState(startCooldown ? RESEND_COOLDOWN_SECONDS : 0);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  function resend() {
    setMessage(null);
    startTransition(async () => {
      const result = await resendConfirmation(email, next);
      if (result.error) {
        setMessage({ text: result.error, error: true });
        if (result.retrySeconds) setSeconds(result.retrySeconds);
        return;
      }
      setMessage({ text: "Email sent. Check your inbox, the Updates or Promotions tab in Gmail, and Spam.", error: false });
      setSeconds(RESEND_COOLDOWN_SECONDS);
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button type="button" variant="ghost" onClick={resend} disabled={pending || seconds > 0} aria-disabled={pending || seconds > 0}>
        {pending ? "Sending…" : seconds > 0 ? `Resend email in ${seconds}s` : "Resend email"}
      </Button>
      <p role={message?.error ? "alert" : "status"} className={`min-h-5 text-[13px] ${message?.error ? "font-medium text-danger" : "text-muted"}`}>
        {message?.text}
      </p>
    </div>
  );
}
