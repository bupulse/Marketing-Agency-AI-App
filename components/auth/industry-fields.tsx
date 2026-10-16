"use client";

import { useEffect, useId, useRef } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  INDUSTRY_DESCRIPTION_EXAMPLE,
  INDUSTRY_DESCRIPTION_MAX,
  INDUSTRY_DESCRIPTION_MIN,
  INDUSTRY_OTHER,
  INDUSTRY_OTHER_MAX,
  type IndustryFieldValues,
  type IndustryOption,
} from "@/lib/industries/shared";

type OnChange = (key: keyof IndustryFieldValues, value: string) => void;

/**
 * Business sector (from Admin -> Industries) plus "Other", which reveals a required "Your industry" input, and the
 * required "Describe your business" text. Shared by sign-up step 2, /welcome and the Brand page.
 */
export function IndustryFields({
  industries,
  values,
  errors,
  onChange,
  compact,
}: {
  industries: IndustryOption[];
  values: IndustryFieldValues;
  errors: Record<string, string>;
  onChange: OnChange;
  /** Brand page: the sector and the text side by side on wide screens. */
  compact?: boolean;
}) {
  const otherId = `industry-other-${useId().replace(/:/g, "")}`;
  const isOther = values.industry === INDUSTRY_OTHER;
  const otherRef = useRef<HTMLInputElement>(null);
  const wasOther = useRef(isOther);
  const count = values.industryDescription.length;
  const short = count > 0 && count < INDUSTRY_DESCRIPTION_MIN;

  // Choosing "Other" reveals the text input and moves focus into it (after the transition has started).
  useEffect(() => {
    if (isOther && !wasOther.current) {
      const t = window.setTimeout(() => otherRef.current?.focus(), 60);
      wasOther.current = true;
      return () => window.clearTimeout(t);
    }
    wasOther.current = isOther;
  }, [isOther]);

  return (
    <>
      <div className={cn("flex flex-col gap-4", compact && "sm:grid sm:grid-cols-2 sm:items-start")}>
        <Field label="Business sector" required error={errors.industry} hint={industries.length === 0 ? "The sector list is unavailable right now: choose Other and type your industry." : undefined}>
          <Select
            name="industry"
            value={values.industry}
            onChange={(e) => onChange("industry", e.target.value)}
            aria-controls={otherId}
            aria-expanded={isOther}
          >
            <option value="">Select your sector</option>
            {industries.map((i) => (
              <option key={i.slug} value={i.slug}>
                {i.name}
              </option>
            ))}
            <option value={INDUSTRY_OTHER}>Other</option>
          </Select>
        </Field>
        <div
          id={otherId}
          role="group"
          aria-label="Your industry"
          aria-hidden={!isOther}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-out-soft motion-reduce:transition-none",
            isOther ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className={cn("min-h-0 overflow-hidden", isOther ? "" : "invisible")}>
            <Field label="Your industry" required={isOther} error={errors.industryOther} hint="A few words, for example: car wash, event planning, poultry farm.">
              <Input
                ref={otherRef}
                name="industryOther"
                maxLength={INDUSTRY_OTHER_MAX}
                autoComplete="off"
                tabIndex={isOther ? undefined : -1}
                value={values.industryOther}
                onChange={(e) => onChange("industryOther", e.target.value)}
              />
            </Field>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Field
          label="Describe your business"
          required
          error={errors.industryDescription}
          hint={`What you sell and who buys it. For example: "${INDUSTRY_DESCRIPTION_EXAMPLE}". ${INDUSTRY_DESCRIPTION_MIN} to ${INDUSTRY_DESCRIPTION_MAX} characters.`}
        >
          <Textarea
            name="industryDescription"
            rows={3}
            maxLength={INDUSTRY_DESCRIPTION_MAX}
            value={values.industryDescription}
            onChange={(e) => onChange("industryDescription", e.target.value)}
          />
        </Field>
        <p aria-live="polite" className={cn("self-end text-xs tabular-nums", short ? "text-danger" : "text-muted")}>
          {count}/{INDUSTRY_DESCRIPTION_MAX}
          {short && <span className="sr-only"> (at least {INDUSTRY_DESCRIPTION_MIN} characters)</span>}
        </p>
      </div>
    </>
  );
}
