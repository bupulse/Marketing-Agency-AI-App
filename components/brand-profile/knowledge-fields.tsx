"use client";

import Link from "next/link";
import { ContactsEditor } from "@/components/business-info/contacts-editor";
import { HoursEditor } from "@/components/business-info/hours-editor";
import { LocationsEditor } from "@/components/business-info/locations-editor";
import { Field, Input } from "@/components/ui";
import type { StepContext } from "./step-fields";
import type { BrandValues, Errors } from "./steps";

function Section({ title, hint, required, children }: { title: string; hint: string; required?: boolean; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[15px] font-semibold">
        {title}
        {required && (
          <>
            <span aria-hidden className="ml-0.5 text-pulse-violet">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </legend>
      <p className="-mt-2 text-[13px] text-muted">{hint}</p>
      {children}
    </fieldset>
  );
}

export function KnowledgeFields({
  values,
  errors,
  onChange,
  context,
}: {
  values: BrandValues;
  errors: Errors;
  onChange: (patch: Partial<BrandValues>) => void;
  context: Pick<StepContext, "country" | "timezone" | "placesEnabled">;
}) {
  return (
    <>
      <Section title="Opening hours" required hint="Required. Choose the days, then drag the handles or use the arrow keys. Days you don't add are shown as closed.">
        <HoursEditor schedules={values.openingHours} errors={errors} timezone={context.timezone} onChange={(openingHours) => onChange({ openingHours })} />
        <Field label="Note on hours (optional)" error={errors.hours} hint="For example: closed on public holidays.">
          <Input name="hours" maxLength={200} placeholder="Closed on public holidays" value={values.hours} onChange={(e) => onChange({ hours: e.target.value })} />
        </Field>
      </Section>

      <Section title="Locations" required hint="Where customers can find you. The head office address is required; branches are optional.">
        <LocationsEditor locations={values.locations} errors={errors} placesEnabled={context.placesEnabled} onChange={(locations) => onChange({ locations })} />
        <Field label="Area you serve (optional)" error={errors.area}>
          <Input name="area" maxLength={200} placeholder="The city centre and nearby neighbourhoods" value={values.area} onChange={(e) => onChange({ area: e.target.value })} />
        </Field>
      </Section>

      <Section title="Contacts" required hint="At least one WhatsApp or phone number is required; email, website and social profiles are optional. The main numbers also appear as buttons in your website chat.">
        <ContactsEditor contacts={values.contacts} errors={errors} country={context.country} onChange={(contacts) => onChange({ contacts })} />
        {(values.contact || errors.contact) && (
          <Field label="Other contact details (optional)" error={errors.contact} hint="From your earlier setup. Add these as contacts above, or keep them here as a note.">
            <Input name="contact" maxLength={200} value={values.contact} onChange={(e) => onChange({ contact: e.target.value })} />
          </Field>
        )}
      </Section>

      {/* FAQs live in the Knowledge base now (one ordered list, no limit of 10), so they are no longer edited here. */}
      <p className="text-[14px] text-muted">
        Common questions and your delivery, returns and payment rules go in{" "}
        <Link href="/dashboard/knowledge/faqs" className="font-semibold">
          Knowledge base → FAQs &amp; policies
        </Link>
        . Your chat assistant answers from them.
      </p>
    </>
  );
}
