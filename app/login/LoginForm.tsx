"use client";

import { useActionState } from "react";
import { sendMagicLink, signInWithGoogle, type LoginState } from "./actions";

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});

  return (
    <div className="flex flex-col gap-6">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="w-full rounded border px-4 py-2">
          Continue with Google
        </button>
      </form>

      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="rounded border px-3 py-2" />
        <button type="submit" disabled={pending} className="rounded border px-4 py-2">
          {pending ? "Sending…" : "Email me a sign-in link"}
        </button>
        {state.message && <p role="status">{state.message}</p>}
        {state.error && <p role="alert">{state.error}</p>}
      </form>
    </div>
  );
}
