"use client";

import { ChevronDown } from "lucide-react";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { CountryCode } from "libphonenumber-js/max";
import { cn } from "@/lib/cn";
import {
  DEFAULT_PHONE_COUNTRY,
  dialCode,
  exampleNational,
  flagEmoji,
  joinPhone,
  phoneCountryName,
  phoneCountryOptions,
  pickerCountry,
  typePhone,
  type PhoneParts,
} from "@/lib/phone";
import { Field } from "./field";
import { fieldBorder } from "./field-styles";

type PhoneControlProps = {
  /** The form field the full number is posted as ("+250 788 000 000", or empty), in a hidden input. */
  name?: string;
  /** Controlled: the full number as `onChange` gave it, or a stored one ("+250788000000", "0788 000 000"). */
  value?: string;
  /** Uncontrolled (server-action forms): the number to start with. */
  defaultValue?: string | null;
  onChange?: (value: string) => void;
  /** ISO code the picker starts on when the number does not say (the business or visitor country); else Rwanda. */
  defaultCountry?: string | null;
  /** ISO code the number must belong to (MoMo is Rwandan only): the flag and dial code show, the picker does not. */
  lockedCountry?: string;
  /** Told when the picker moves, by hand or because a number with another dial code was typed or pasted. */
  onCountryChange?: (country: CountryCode) => void;
  /** Defaults to the country's example ("791 954 277"). */
  placeholder?: string;
  disabled?: boolean;
  /** The picker's accessible name. */
  countryLabel?: string;
  // Set by Field (components/ui/field.tsx), or by a form with its own label.
  id?: string;
  required?: boolean;
  invalid?: boolean;
  "aria-describedby"?: string;
};

export type PhoneInputProps = PhoneControlProps & {
  /** With a label, the control comes in a Field (label, hint, error); without one the caller labels it (pass `id`). */
  label?: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
};

/**
 * The phone field every form uses: a country picker showing the flag and dial code (🇷🇼 +250 ▾), then the number,
 * grouped as it is typed ("788 000 000"). The picker is a native select under the flag, so phones open their own
 * list and screen readers read "🇷🇼 Rwanda +250". "0788..." drops the 0; a number typed or pasted with its own dial
 * code ("+254 712...", "00254 712...") moves the picker to its country. The form gets "+250 788 000 000".
 */
export function PhoneInput({ label, hint, error, className, ...control }: PhoneInputProps) {
  if (!label) return <PhoneControl {...control} invalid={control.invalid ?? (error ? true : undefined)} />;
  return (
    <Field label={label} hint={hint} error={error} required={control.required} className={className}>
      <PhoneControl {...control} />
    </Field>
  );
}

const digitsOf = (text: string) => text.replace(/\D/g, "");

function PhoneControl({
  name,
  value,
  defaultValue,
  onChange,
  defaultCountry,
  lockedCountry,
  onCountryChange,
  placeholder,
  disabled,
  countryLabel = "Country code",
  id,
  required,
  invalid,
  "aria-describedby": describedBy,
}: PhoneControlProps) {
  const locked = pickerCountry(lockedCountry);
  const wanted = pickerCountry(defaultCountry);
  const [parts, setParts] = useState<PhoneParts>(() => typePhone(value ?? defaultValue ?? "", locked ?? wanted ?? DEFAULT_PHONE_COUNTRY, !!locked));
  // A parent that changes the value itself (cleared it, loaded a saved number) is shown as it gave it; our own
  // changes come back equal to what we show and change nothing.
  const [seen, setSeen] = useState(value);
  if (value !== undefined && value !== seen) {
    setSeen(value);
    if (value !== joinPhone(parts)) setParts(typePhone(value, locked ?? parts.country, !!locked));
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const pickedByHand = useRef(false);
  const lastWanted = useRef(wanted);
  const lockedId = `${useId().replace(/:/g, "")}-country`;

  function emit(next: PhoneParts) {
    setParts(next);
    if (next.country !== parts.country) onCountryChange?.(next.country);
    onChange?.(joinPhone(next));
  }

  function changeCountry(country: CountryCode) {
    const digits = parts.national.startsWith("+") ? "" : digitsOf(parts.national);
    emit({ country, national: digits ? typePhone(digits, country).national : "" });
  }

  // The default country can change under the field (sign-up's business country select): the picker follows it until
  // the person picks a country themselves, regrouping what they typed for the new country.
  useEffect(() => {
    if (lastWanted.current === wanted) return;
    lastWanted.current = wanted;
    if (wanted && !locked && !pickedByHand.current && wanted !== parts.country) changeCountry(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the default country changes, not on every keystroke
  }, [wanted]);

  function onNumber(e: ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    let text = el.value;
    let at = el.selectionStart ?? text.length;
    // Backspace on a space between groups would only remove the space, which the grouping puts straight back:
    // remove the digit before it instead.
    if (text.length < parts.national.length && digitsOf(text) === digitsOf(parts.national) && at > 0) {
      const before = text.slice(0, at).search(/\d[^\d]*$/);
      if (before >= 0) {
        text = text.slice(0, before) + text.slice(before + 1);
        at = before;
      }
    }
    const next = typePhone(text, parts.country, !!locked);
    // Keep the caret after the same digit while editing in the middle (digits dropped from the front, like the
    // trunk 0 or a dial code that moved to the picker, are taken off); at the end it stays at the end.
    const dropped = Math.max(0, digitsOf(text).length - digitsOf(next.national).length);
    caret.current = at >= text.length ? null : Math.max(0, digitsOf(text.slice(0, at)).length - dropped);
    emit(next);
  }

  useLayoutEffect(() => {
    const el = inputRef.current;
    const wantedDigits = caret.current;
    caret.current = null;
    if (wantedDigits === null || !el || document.activeElement !== el) return;
    let pos = 0;
    for (let seenDigits = 0; pos < el.value.length && seenDigits < wantedDigits; pos++) if (/\d/.test(el.value[pos])) seenDigits++;
    el.setSelectionRange(pos, pos);
  }, [parts.national]);

  const country = parts.country;
  return (
    <div
      data-invalid={invalid || undefined}
      className={cn(
        "flex w-full rounded-field border bg-glass text-[15px] font-normal text-text transition-[border-color,box-shadow] duration-200",
        "focus-within:border-pulse-blue focus-within:shadow-ring",
        "data-[invalid=true]:border-danger data-[invalid=true]:focus-within:shadow-[0_0_0_4px_var(--bp-danger-bg)]",
        fieldBorder,
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <div className="relative flex shrink-0 items-center gap-1.5 border-r border-line pr-2.5 pl-3.5">
        <span aria-hidden className="text-lg leading-none">
          {flagEmoji(country)}
        </span>
        <span aria-hidden className="font-medium tabular-nums">
          {dialCode(country)}
        </span>
        {locked ? (
          <span id={lockedId} className="sr-only">
            {phoneCountryName(locked)} {dialCode(locked)}
          </span>
        ) : (
          <>
            <ChevronDown aria-hidden className="size-4 text-muted" />
            {/* Transparent over the flag: the closed field shows only "🇷🇼 +250", the open list the full names. */}
            <select
              aria-label={countryLabel}
              autoComplete="tel-country-code"
              value={country}
              disabled={disabled}
              onChange={(e) => {
                pickedByHand.current = true;
                changeCountry(e.target.value as CountryCode);
              }}
              className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            >
              <CountryOptions />
            </select>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required={required}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, locked ? lockedId : null].filter(Boolean).join(" ") || undefined}
        placeholder={placeholder ?? exampleNational(country)}
        value={parts.national}
        onChange={onNumber}
        className="min-h-12 w-full min-w-0 flex-1 rounded-r-field bg-transparent px-3.5 py-3 text-[15px] text-text outline-none placeholder:text-muted/80 disabled:cursor-not-allowed"
      />
      {name && <input type="hidden" name={name} value={joinPhone(parts)} />}
    </div>
  );
}

// 245 options that never change: built once, not on every keystroke. The names come from Intl.DisplayNames, whose
// wording can differ a little between Node and a browser, hence suppressHydrationWarning on each option.
const CountryOptions = memo(function CountryOptions() {
  return phoneCountryOptions().map((o) => (
    <option key={o.code} value={o.code} suppressHydrationWarning>
      {`${o.flag} ${o.name} ${o.dial}`}
    </option>
  ));
});
