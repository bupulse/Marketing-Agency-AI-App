"use client";

import { useEffect, useRef } from "react";
import { Field, Input } from "@/components/ui";
import { dialCode, examplePhone, formatAsYouType, phoneCountry } from "@/lib/phone";

/**
 * Phone input driven by the country select: shows the dial code (+250) and groups the digits as you type
 * ("+250 791 954 277"). Pasting "0791954277", "791954277" or "+250791954277" all end up the same. `value` is the
 * displayed text; the schemas turn it into E.164 when saving.
 */
export function PhoneField({
  value,
  country,
  error,
  label = "Phone (optional)",
  required,
  onChange,
}: {
  value: string;
  /** The sign-up country name ("Rwanda"); decides the dial code and the validation. */
  country: string;
  error?: string;
  label?: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const code = phoneCountry(country);
  const prefix = dialCode(code);
  const lastCountry = useRef(code);

  // A new country regroups what was typed so far (a national number takes the new dial code; "+..." stays).
  useEffect(() => {
    if (lastCountry.current === code) return;
    lastCountry.current = code;
    if (value) onChange(formatAsYouType(value, code));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the country changes, not on every keystroke
  }, [code]);

  return (
    <Field label={label} required={required} error={error} hint={prefix ? `${country}: ${prefix}. Example ${examplePhone(code)}.` : undefined}>
      <Input
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={examplePhone(code)}
        value={value}
        onChange={(e) => onChange(formatAsYouType(e.target.value, code))}
        onFocus={() => {
          if (!value && prefix) onChange(`${prefix} `);
        }}
        onBlur={() => {
          if (value.trim() === prefix) onChange("");
        }}
      />
    </Field>
  );
}
