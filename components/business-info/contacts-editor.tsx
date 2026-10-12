"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PhoneField } from "@/components/auth/phone-field";
import { Button, Field, Input, Select } from "@/components/ui";
import { CONTACT_LABELS, CONTACT_TYPES, MAX_CONTACTS, isPhoneType, type ContactType } from "@/lib/business-info/contacts";
import { countries } from "@/lib/content/countries";
import type { ContactValue } from "@/components/brand-profile/steps";

const PLACEHOLDERS: Partial<Record<ContactType, string>> = {
  email: "hello@yourbusiness.com",
  website: "yourbusiness.com",
  instagram: "@yourbusiness or instagram.com/yourbusiness",
  facebook: "facebook.com/yourbusiness",
  tiktok: "@yourbusiness",
};

/**
 * Contacts: WhatsApp and phone numbers (country picker, then grouped as typed: +250 791 954 277), email, website and
 * social profiles. One is the main contact: the chat widget's WhatsApp and Call buttons prefer it.
 */
export function ContactsEditor({
  contacts,
  errors,
  country,
  onChange,
}: {
  contacts: ContactValue[];
  errors: Record<string, string>;
  /** Business sign-up country name: the phone country of new contacts. */
  country: string;
  onChange: (contacts: ContactValue[]) => void;
}) {
  const group = `primary${useId().replace(/:/g, "")}`;

  function update(i: number, patch: Partial<ContactValue>) {
    onChange(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  function setType(i: number, type: ContactType) {
    const before = contacts[i];
    // A number stays when switching between WhatsApp and calls; other switches start empty.
    const keep = isPhoneType(before.type) === isPhoneType(type);
    update(i, { type, value: keep ? before.value : "" });
  }

  function remove(i: number) {
    const next = contacts.filter((_, j) => j !== i);
    if (contacts[i].primary && next.length) next[0] = { ...next[0], primary: true };
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {contacts.map((c, i) => {
        const error = errors[`contacts.${i}.value`];
        return (
          <div key={i} className="glass flex flex-col gap-3 rounded-2xl p-4">
            <Field label="Type" error={errors[`contacts.${i}.type`]}>
              <Select value={c.type} onChange={(e) => setType(i, e.target.value as ContactType)}>
                {CONTACT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CONTACT_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            {isPhoneType(c.type) ? (
              <>
                <Field label="Country">
                  <Select autoComplete="country-name" value={c.country} onChange={(e) => update(i, { country: e.target.value })}>
                    <option value="">Select a country</option>
                    {countries.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <PhoneField label="Number" value={c.value} country={c.country} error={error} onChange={(value) => update(i, { value })} />
              </>
            ) : (
              <Field label={c.type === "email" ? "Email" : c.type === "website" ? "Website" : `${CONTACT_LABELS[c.type]} handle or link`} error={error}>
                <Input
                  type={c.type === "email" ? "email" : c.type === "website" ? "url" : "text"}
                  inputMode={c.type === "email" ? "email" : c.type === "website" ? "url" : undefined}
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={300}
                  placeholder={PLACEHOLDERS[c.type]}
                  value={c.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              </Field>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
                <input
                  type="radio"
                  name={group}
                  checked={c.primary}
                  onChange={() => onChange(contacts.map((o, j) => ({ ...o, primary: j === i })))}
                  className="size-5 shrink-0 cursor-pointer accent-pulse-blue"
                />
                Main contact
              </label>
              <Button variant="outline" size="sm" leading={<Trash2 aria-hidden className="size-4" />} onClick={() => remove(i)}>
                Remove contact {i + 1}
              </Button>
            </div>
          </div>
        );
      })}
      {errors["contacts.form"] && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {errors["contacts.form"]}
        </p>
      )}
      {contacts.length < MAX_CONTACTS && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          leading={<Plus aria-hidden className="size-4" />}
          onClick={() => onChange([...contacts, { type: "whatsapp", value: "", country, primary: contacts.length === 0 }])}
        >
          Add contact
        </Button>
      )}
    </div>
  );
}
