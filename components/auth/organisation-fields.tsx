"use client";

import Link from "next/link";
import { Field, Input, Select } from "@/components/ui";
import { countries } from "@/lib/content/countries";
import { industryOptions, type FieldErrors } from "@/lib/auth/schemas";

export type OrganisationValues = {
  organisationName: string;
  ceoName: string;
  industry: string;
  country: string;
  phone: string;
  website: string;
};

type OnChange = (key: keyof OrganisationValues, value: string) => void;

/** Organisation details, shared by sign-up step 2 and /welcome (Google sign-ups). */
export function OrganisationFields({
  values,
  errors,
  onChange,
}: {
  values: OrganisationValues;
  errors: FieldErrors;
  onChange: OnChange;
}) {
  return (
    <>
      <Field label="Organisation name" required error={errors.organisationName}>
        <Input
          name="organisationName"
          autoComplete="organization"
          value={values.organisationName}
          onChange={(e) => onChange("organisationName", e.target.value)}
        />
      </Field>
      <Field label="CEO name" required error={errors.ceoName}>
        <Input name="ceoName" autoComplete="name" value={values.ceoName} onChange={(e) => onChange("ceoName", e.target.value)} />
      </Field>
      <Field label="Industry" required error={errors.industry}>
        <Select name="industry" value={values.industry} onChange={(e) => onChange("industry", e.target.value)}>
          <option value="">Select your industry</option>
          {industryOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Country" required error={errors.country}>
        <Select name="country" autoComplete="country-name" value={values.country} onChange={(e) => onChange("country", e.target.value)}>
          <option value="">Select your country</option>
          {countries.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Phone (optional)" error={errors.phone}>
        <Input
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+1 555 123 4567"
          value={values.phone}
          onChange={(e) => onChange("phone", e.target.value)}
        />
      </Field>
      <Field label="Website (optional)" error={errors.website}>
        <Input
          name="website"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="yourbusiness.com"
          value={values.website}
          onChange={(e) => onChange("website", e.target.value)}
        />
      </Field>
    </>
  );
}

/** "I agree to the Terms and Privacy Policy" checkbox with its error. */
export function TermsField({
  checked,
  error,
  onChange,
}: {
  checked: boolean;
  error?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-text">
        <input
          type="checkbox"
          name="terms"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "terms-error" : undefined}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-pulse-blue"
        />
        <span>
          I agree to the{" "}
          <Link href="/terms" target="_blank" className="font-semibold underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="font-semibold underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {error && (
        <p id="terms-error" role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
