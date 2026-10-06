"use client";

import { Field, Textarea } from "@/components/ui";
import type { BrandValues, Errors } from "./steps";

export function OfferFields({
  values,
  errors,
  onChange,
}: {
  values: BrandValues;
  errors: Errors;
  onChange: (patch: Partial<BrandValues>) => void;
}) {
  return (
    <>
      <Field label="What do you sell or do?" required error={errors.description} hint="For example: fresh bread, phone repairs, or after-school classes.">
        <Textarea
          name="description"
          rows={4}
          maxLength={500}
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
      <Field label="Who are your customers?" required error={errors.audience} hint="For example: families nearby, small offices, first-time home buyers.">
        <Textarea
          name="audience"
          rows={3}
          maxLength={300}
          value={values.audience}
          onChange={(e) => onChange({ audience: e.target.value })}
        />
      </Field>
    </>
  );
}
