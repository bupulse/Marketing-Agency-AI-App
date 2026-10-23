"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui";
import { COPY } from "@/lib/support/client/copy";
import { checkPrechat, type PrechatErrors, type PrechatValues } from "@/lib/support/client/prechat";
import { cn } from "@/lib/cn";

const LABEL = "flex flex-col gap-1.5 text-[13px] font-semibold";

/** Name, email and business (required), WhatsApp (optional), for visitors without an account. Becomes a lead. */
export function PrechatForm({ firstRef, onSubmit }: { firstRef: React.RefObject<HTMLInputElement | null>; onSubmit: (body: { name: string; email: string; business: string; whatsapp?: string }) => Promise<void> }) {
  const [v, setV] = useState<PrechatValues>({ name: "", email: "", business: "", whatsapp: "" });
  const [errors, setErrors] = useState<PrechatErrors>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const set = (k: keyof PrechatValues) => (e: React.ChangeEvent<HTMLInputElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const err = (k: keyof PrechatValues) =>
    errors[k] ? (
      <span id={`sc-${k}-err`} className="text-xs font-normal text-danger">
        {errors[k]}
      </span>
    ) : null;
  const login = typeof window === "undefined" ? "/login" : `/login?next=${encodeURIComponent(window.location.pathname)}`;

  return (
    <form
      noValidate
      className="flex flex-1 flex-col gap-3.5 overflow-auto px-5 pt-5 pb-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = checkPrechat(v);
        if (!r.ok) {
          setErrors(r.errors);
          return;
        }
        setErrors({});
        setFailed(null);
        setBusy(true);
        try {
          await onSubmit(r.body);
        } catch {
          setFailed(COPY.somethingWrong);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-xl font-bold tracking-[-0.02em]">{COPY.formTitle}</h2>
        <p className="m-0 text-sm leading-[1.45] text-muted">{COPY.formSub}</p>
      </div>
      <label className={LABEL}>
        {COPY.name}
        <Input ref={firstRef} name="name" autoComplete="name" value={v.name} onChange={set("name")} invalid={!!errors.name} aria-describedby={errors.name ? "sc-name-err" : undefined} required />
        {err("name")}
      </label>
      <label className={LABEL}>
        {COPY.email}
        <Input type="email" name="email" autoComplete="email" inputMode="email" value={v.email} onChange={set("email")} invalid={!!errors.email} aria-describedby={errors.email ? "sc-email-err" : undefined} required />
        {err("email")}
      </label>
      <label className={LABEL}>
        {COPY.business}
        <Input name="organization" autoComplete="organization" placeholder={COPY.businessHint} value={v.business} onChange={set("business")} invalid={!!errors.business} aria-describedby={errors.business ? "sc-business-err" : undefined} required />
        {err("business")}
      </label>
      <label className={LABEL}>
        <span>
          {COPY.whatsappField} <span className="font-normal text-muted">{COPY.optional}</span>
        </span>
        <span className={cn("flex overflow-hidden rounded-field border focus-within:border-pulse-blue focus-within:shadow-ring", errors.whatsapp ? "border-danger" : "border-line")}>
          <span className="flex items-center border-r border-line bg-soft px-3 text-[15px] font-medium">+250</span>
          <input
            type="tel"
            name="whatsapp"
            autoComplete="tel-national"
            inputMode="tel"
            placeholder={COPY.phoneHint}
            value={v.whatsapp}
            onChange={set("whatsapp")}
            aria-invalid={!!errors.whatsapp || undefined}
            aria-describedby={errors.whatsapp ? "sc-whatsapp-err" : undefined}
            className="min-h-12 min-w-0 flex-1 border-0 bg-transparent px-3.5 text-[15px] font-normal text-text outline-none placeholder:text-muted/80"
          />
        </span>
        {err("whatsapp")}
      </label>
      {failed && (
        <p role="alert" className="m-0 text-sm text-danger">
          {failed}
        </p>
      )}
      <button type="submit" disabled={busy} className="mt-1 min-h-12 cursor-pointer rounded-full border-0 bg-brand-gradient px-4 text-base font-semibold text-white shadow-glow disabled:opacity-60">
        {busy ? COPY.starting : COPY.start}
      </button>
      <p className="m-0 text-xs leading-[1.5] text-muted">
        {COPY.privacyLine}{" "}
        <Link href="/privacy#support-chat" className="text-[color:var(--bp-link)] underline">
          {COPY.privacyLink}
        </Link>
      </p>
      <p className="m-0 mt-auto text-center text-xs text-muted">
        {COPY.loginLine}{" "}
        <a href={login} className="text-[color:var(--bp-link)] underline">
          {COPY.loginLink}
        </a>{" "}
        {COPY.loginRest}
      </p>
    </form>
  );
}
