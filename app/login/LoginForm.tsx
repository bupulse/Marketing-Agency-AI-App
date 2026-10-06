"use client";

import { MailCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { sendMagicLink, signInWithGoogle, type LoginState } from "./actions";

function GoogleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path fill="#4285F4" d="M23 12.27c0-.8-.07-1.56-.2-2.3H12v4.35h6.17a5.28 5.28 0 0 1-2.29 3.46v2.87h3.7C21.74 18.65 23 15.7 23 12.27z" />
      <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1.03 7.6-2.79l-3.7-2.87c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.53-2.03-6.44-4.76H1.74v2.96A11.5 11.5 0 0 0 12 23.5z" />
      <path fill="#FBBC05" d="M5.56 14.18a6.9 6.9 0 0 1 0-4.36V6.86H1.74a11.5 11.5 0 0 0 0 10.28l3.82-2.96z" />
      <path fill="#EA4335" d="M12 5.06c1.69 0 3.2.58 4.4 1.72l3.28-3.28A11.04 11.04 0 0 0 12 .5 11.5 11.5 0 0 0 1.74 6.86l3.82 2.96C6.47 7.09 9 5.06 12 5.06z" />
    </svg>
  );
}

function EmailForm({ next, onReset }: { next: string; onReset: () => void }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});
  const [email, setEmail] = useState("");

  if (state.message) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-2xl bg-success-bg px-5 py-6 text-center">
        <MailCheck aria-hidden className="size-9 text-success" />
        <h2 className="text-lg font-semibold text-text">Check your email</h2>
        <p className="text-sm text-muted">
          We sent a sign-in link to <strong className="break-all text-text">{email.trim()}</strong>. Open it on this device to continue.
        </p>
        <button type="button" onClick={onReset} className="min-h-11 cursor-pointer text-sm font-semibold text-pulse-blue underline">
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" error={state.error} required>
        <Input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@yourbusiness.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}

export default function LoginForm({ next }: { next: string }) {
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="white" size="lg" className="w-full" leading={<GoogleIcon />}>
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <EmailForm key={attempt} next={next} onReset={() => setAttempt((a) => a + 1)} />
    </div>
  );
}
