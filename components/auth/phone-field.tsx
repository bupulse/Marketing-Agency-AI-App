"use client";

import { PhoneInput } from "@/components/ui";
import { phoneCountry } from "@/lib/phone";

/**
 * The business phone (sign-up, /welcome, Settings, Business info contacts): the shared phone input, starting on the
 * business country's flag and dial code. Picking another country is allowed (a Rwandan company with a Kenyan line);
 * `onCountryChange` tells the form, which posts it as `phoneCountry` so the schemas check the number against it.
 * `value` is "+250 791 954 277" as shown; the schemas turn it into E.164 when saving.
 */
export function PhoneField({
  value,
  country,
  error,
  label = "Phone (optional)",
  required,
  onChange,
  onCountryChange,
}: {
  value: string;
  /** The sign-up country name ("Rwanda"); the picker starts on it and follows it while nobody picked by hand. */
  country: string;
  error?: string;
  label?: string;
  required?: boolean;
  onChange: (value: string) => void;
  /** The ISO code ("KE") whenever the picker moves. */
  onCountryChange?: (country: string) => void;
}) {
  return (
    <PhoneInput
      name="phone"
      label={label}
      required={required}
      error={error}
      value={value}
      defaultCountry={phoneCountry(country)}
      onChange={onChange}
      onCountryChange={onCountryChange}
    />
  );
}
