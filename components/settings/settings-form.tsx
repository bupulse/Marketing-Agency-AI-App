"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button, Field, GlassCard, Input } from "@/components/ui";
import type { FieldErrors } from "@/lib/auth/schemas";
import Link from "next/link";
import { saveBusiness, saveProfile, type SettingsState } from "@/app/dashboard/settings/actions";
import { PhoneField } from "@/components/auth/phone-field";

/** Settings -> Business: the details the owner may change. The sector lives on the Brand page; the country is fixed. */
export type BusinessDetailsValues = { organisationName: string; ceoName: string; phone: string; website: string };

function Section({ id, title, text, children }: { id: string; title: string; text: string; children: ReactNode }) {
  return (
    <GlassCard as="section" aria-labelledby={id} className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted">{text}</p>
      </div>
      {children}
    </GlassCard>
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
    <Section id="profile" title="Profile" text="How you appear in BuPulse.">
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
        <Field label="Email" hint={`You sign in with: ${signInMethod}.`}>
          <Input value={email} readOnly />
        </Field>
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
    <Section id="business" title="Business" text="Your company's details. The sector and description are on the Brand page.">
      <form action={submitAction} noValidate className="flex flex-col gap-4">
        <Field label="Organisation name" required error={errors.organisationName}>
          <Input name="organisationName" autoComplete="organization" value={values.organisationName} onChange={(e) => set("organisationName", e.target.value)} />
        </Field>
        <Field label="CEO name" required error={errors.ceoName}>
          <Input name="ceoName" autoComplete="name" value={values.ceoName} onChange={(e) => set("ceoName", e.target.value)} />
        </Field>
        <Field label="Business sector" hint={<>Change it on the <Link href="/dashboard/brand" className="underline">Brand page</Link>.</>}>
          <Input value={industryLabel || "Not set yet"} readOnly />
        </Field>
        <Field label="Country" hint="Decides your prices and currency. To change it, contact us.">
          <Input name="countryDisplay" value={country || "Not set"} readOnly />
        </Field>
        <PhoneField value={values.phone} country={country} error={errors.phone} onChange={(v) => set("phone", v)} />
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
