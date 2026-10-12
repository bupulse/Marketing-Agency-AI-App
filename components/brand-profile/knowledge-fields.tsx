"use client";

import { Plus, Trash2 } from "lucide-react";
import { ContactsEditor } from "@/components/business-info/contacts-editor";
import { HoursEditor } from "@/components/business-info/hours-editor";
import { LocationsEditor } from "@/components/business-info/locations-editor";
import { Button, Field, Input, Textarea } from "@/components/ui";
import type { StepContext } from "./step-fields";
import type { BrandValues, Errors } from "./steps";

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[15px] font-semibold">{title}</legend>
      <p className="-mt-2 text-[13px] text-muted">{hint}</p>
      {children}
    </fieldset>
  );
}

export function KnowledgeFields({
  values,
  errors,
  onChange,
  maxFaqs,
  context,
}: {
  values: BrandValues;
  errors: Errors;
  onChange: (patch: Partial<BrandValues>) => void;
  maxFaqs: number;
  context: Pick<StepContext, "country" | "timezone" | "placesEnabled">;
}) {
  function setFaq(index: number, patch: Partial<BrandValues["faqs"][number]>) {
    onChange({ faqs: values.faqs.map((f, i) => (i === index ? { ...f, ...patch } : f)) });
  }

  return (
    <>
      <Section title="Opening hours" hint="Choose the days, then drag the handles or use the arrow keys. Days you don't add are shown as closed.">
        <HoursEditor schedules={values.openingHours} errors={errors} timezone={context.timezone} onChange={(openingHours) => onChange({ openingHours })} />
        <Field label="Note on hours (optional)" error={errors.hours} hint="For example: closed on public holidays.">
          <Input name="hours" maxLength={200} placeholder="Closed on public holidays" value={values.hours} onChange={(e) => onChange({ hours: e.target.value })} />
        </Field>
      </Section>

      <Section title="Locations" hint="Where customers can find you. Add the head office first, then any branches.">
        <LocationsEditor locations={values.locations} errors={errors} placesEnabled={context.placesEnabled} onChange={(locations) => onChange({ locations })} />
        <Field label="Area you serve (optional)" error={errors.area}>
          <Input name="area" maxLength={200} placeholder="The city centre and nearby neighbourhoods" value={values.area} onChange={(e) => onChange({ area: e.target.value })} />
        </Field>
      </Section>

      <Section title="Contacts" hint="How customers can reach you. The main WhatsApp and phone numbers also appear as buttons in your website chat.">
        <ContactsEditor contacts={values.contacts} errors={errors} country={context.country} onChange={(contacts) => onChange({ contacts })} />
        {(values.contact || errors.contact) && (
          <Field label="Other contact details (optional)" error={errors.contact} hint="From your earlier setup. Add these as contacts above, or keep them here as a note.">
            <Input name="contact" maxLength={200} value={values.contact} onChange={(e) => onChange({ contact: e.target.value })} />
          </Field>
        )}
      </Section>

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
