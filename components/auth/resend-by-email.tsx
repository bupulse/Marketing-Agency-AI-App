"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui";
import { ResendButton } from "./resend-button";

/** For an expired or used confirmation link: ask for the address again and resend. */
export function ResendByEmail() {
  const [email, setEmail] = useState("");
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-danger-bg px-4 py-4 text-sm">
      <p role="alert" className="font-medium text-danger">
        This link has expired or was already used. If you have already confirmed, sign in below. Otherwise we can send a new code and link.
      </p>
      <Field label="Email">
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbusiness.com" />
      </Field>
      {email.includes("@") && <ResendButton email={email.trim()} />}
    </div>
  );
}
