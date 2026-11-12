"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Building2, UserRound, type LucideIcon } from "lucide-react";
import { BPanel } from "@/components/app/kit/b-cards";
import { Button, Field, Input } from "@/components/ui";
import type { FieldErrors } from "@/lib/auth/schemas";
import Link from "next/link";
import { saveBusiness, saveProfile, type SettingsState } from "@/app/dashboard/settings/actions";
import { PhoneField } from "@/components/auth/phone-field";

/** Settings -> Business: the details the owner may change. The sector lives on the Brand page; the country is fixed. */
/** `phoneCountry`: the ISO code on the phone field's picker (the stored number's country to start with). */
export type BusinessDetailsValues = { organisationName: string; ceoName: string; phone: string; phoneCountry: string; website: string };

function Section({ id, icon, title, text, children }: { id: string; icon: LucideIcon; title: string; text: string; children: ReactNode }) {
  return (
    <BPanel id={id} icon={icon} title={title} hint={text}>
      {children}
    </BPanel>
  );
}

/** A read-only fact (label, value, one line on how to change it): no box to type in. */
function Fact({ label, value, hint }: { label: string; value: string; hint: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-soft px-4 py-3">
      <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</span>
      <span className="truncate text-[15px] font-semibold">{value}</span>
      <span className="text-[13px] text-muted">{hint}</span>
    </div>
  );
}

function Status({ state }: { state: SettingsState }) {
  return (
    <div role="status" aria-live="polite" className="text-sm font-medium">
      {state.saved && <span className="text-ok">Saved.</span>}
      {state.error && <span className="text-danger">{state.error}</span>}
    </div>
  );
}

// Server-side field errors, cleared per field as the person edits it.
function useServerErrors(state: SettingsState) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [handled, setHandled] = useState<SettingsState | null>(null);
  if (state.fieldErrors && handled !== state) {
    setHandled(state);
    setErrors(state.fieldErrors);
  }
  return { errors, clear: (key: string) => errors[key] && setErrors((e) => ({ ...e, [key]: "" })) };
}

export function ProfileSection({
  name,
  email,
  signInMethod,
}: {
  name: string;
  email: string;
  signInMethod: string;
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(saveProfile, {});
  const [value, setValue] = useState(name);
  const { errors, clear } = useServerErrors(state);

  return (
    <Section id="profile" icon={UserRound} title="Your profile" text="How you appear to your team in BuPulse.">
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <Field label="Your name" required error={errors.name}>
          <Input
            name="name"
            autoComplete="name"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              clear("name");
            }}
          />
        </Field>
        <Fact label="Email" value={email} hint={`You sign in with: ${signInMethod}.`} />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
          <Status state={state} />
        </div>
      </form>
    </Section>
  );
}

export function BusinessSection({ defaults, country, industryLabel }: { defaults: BusinessDetailsValues; country: string; industryLabel: string }) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(saveBusiness, {});
  const [values, setValues] = useState(defaults);
  const { errors, clear } = useServerErrors(state);

  function submitAction() {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    formAction(fd);
  }
  const set = (key: keyof BusinessDetailsValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    clear(key);
  };

  return (
    <Section id="business" icon={Building2} title="Company details" text="Your company's name, boss, phone and website.">
      <form action={submitAction} noValidate className="flex flex-col gap-4">
        <Field label="Organisation name" required error={errors.organisationName}>
          <Input name="organisationName" autoComplete="organization" value={values.organisationName} onChange={(e) => set("organisationName", e.target.value)} />
        </Field>
        <Field label="CEO name" required error={errors.ceoName}>
          <Input name="ceoName" autoComplete="name" value={values.ceoName} onChange={(e) => set("ceoName", e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Fact label="Business sector" value={industryLabel || "Not set yet"} hint={<>Change it on the <Link href="/dashboard/brand" className="underline">Brand page</Link>.</>} />
          <Fact label="Country" value={country || "Not set"} hint="Decides your prices and currency. To change it, contact us." />
        </div>
        <PhoneField value={values.phone} country={country} error={errors.phone} onChange={(v) => set("phone", v)} onCountryChange={(c) => set("phoneCountry", c)} />
        <Field label="Website (optional)" error={errors.website}>
          <Input name="website" type="url" inputMode="url" autoComplete="url" placeholder="yourbusiness.com" value={values.website} onChange={(e) => set("website", e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save business"}
          </Button>
          <Status state={state} />
        </div>
      </form>
    </Section>
  );
}
