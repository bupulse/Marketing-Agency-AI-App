"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import type { BrandValues, Errors } from "./steps";

export function KnowledgeFields({
  values,
  errors,
  onChange,
  maxFaqs,
}: {
  values: BrandValues;
  errors: Errors;
  onChange: (patch: Partial<BrandValues>) => void;
  maxFaqs: number;
}) {
  function setFaq(index: number, patch: Partial<BrandValues["faqs"][number]>) {
    onChange({ faqs: values.faqs.map((f, i) => (i === index ? { ...f, ...patch } : f)) });
  }

  return (
    <>
      <Field label="Opening hours" error={errors.hours}>
        <Input name="hours" maxLength={200} placeholder="Mon to Sat, 9am to 6pm" value={values.hours} onChange={(e) => onChange({ hours: e.target.value })} />
      </Field>
      <Field label="Area you serve" error={errors.area}>
        <Input name="area" maxLength={200} placeholder="Downtown and nearby suburbs" value={values.area} onChange={(e) => onChange({ area: e.target.value })} />
      </Field>
      <Field label="How should customers contact you?" error={errors.contact}>
        <Input name="contact" maxLength={200} placeholder="Call or WhatsApp +1 555 123 4567" value={values.contact} onChange={(e) => onChange({ contact: e.target.value })} />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-medium text-muted">Common questions (up to {maxFaqs})</legend>
        {values.faqs.map((faq, i) => (
          <div key={i} className="glass flex flex-col gap-3 rounded-2xl p-4">
            <Field label={`Question ${i + 1}`} error={errors[`faqs.${i}.question`]}>
              <Input name={`faqs.${i}.question`} maxLength={200} placeholder="Do you offer delivery?" value={faq.question} onChange={(e) => setFaq(i, { question: e.target.value })} />
            </Field>
            <Field label="Answer" error={errors[`faqs.${i}.answer`]}>
              <Textarea name={`faqs.${i}.answer`} rows={2} maxLength={600} value={faq.answer} onChange={(e) => setFaq(i, { answer: e.target.value })} />
            </Field>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              leading={<Trash2 aria-hidden className="size-4" />}
              onClick={() => onChange({ faqs: values.faqs.filter((_, j) => j !== i) })}
            >
              Remove question {i + 1}
            </Button>
          </div>
        ))}
        {values.faqs.length < maxFaqs && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            leading={<Plus aria-hidden className="size-4" />}
            onClick={() => onChange({ faqs: [...values.faqs, { question: "", answer: "" }] })}
          >
            Add a question
          </Button>
        )}
      </fieldset>
    </>
  );
}
