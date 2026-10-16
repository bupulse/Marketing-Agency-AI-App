"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button, Field, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { IndustryFields } from "@/components/auth/industry-fields";
import { saveProfile } from "@/app/dashboard/knowledge/profile/actions";
import type { IndustryOption } from "@/lib/industries/shared";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { COMMON_LANGUAGES, COMPANY_SIZES, MAX_ACHIEVEMENTS, MAX_LANGUAGES, MAX_VALUES, PROFILE_LIMITS, profileInputSchema, SIZE_LABEL, type ProfileFormValues, type ProfileInput } from "@/lib/knowledge/profile";
import { ListField } from "./list-field";

/** Knowledge base -> Company profile. Checked in the browser with the server's schema, then saved by saveProfile. */
export function ProfileForm({ industries, initial }: { industries: IndustryOption[]; initial: ProfileFormValues }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function set<K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function submit() {
    setFormError(null);
    const check = profileInputSchema().safeParse(values);
    if (!check.success) {
      const found = fieldErrorMap(check.error);
      setErrors(found);
      setFormError("Check the highlighted fields.");
      document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      return;
    }
    start(async () => {
      const result = await saveProfile(values as ProfileInput);
      if (result.ok) {
        setSaved(true);
        toast("Company profile saved.", "success");
        router.refresh();
        return;
      }
      if (result.fieldErrors) setErrors(result.fieldErrors);
      setFormError(result.error);
    });
  }

  const text = (key: "tagline" | "mission" | "vision" | "legalName" | "registrationNumber" | "serviceArea") => ({
    value: values[key],
    maxLength: PROFILE_LIMITS[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value),
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <GlassCard as="section" aria-labelledby="profile-basics" className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 id="profile-basics" className="text-lg font-semibold tracking-[-0.02em]">
          The basics
        </h2>
        <Field label="Company name" required error={errors.name} hint="As customers know you.">
          <Input value={values.name} maxLength={PROFILE_LIMITS.name} autoComplete="organization" onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Tagline" error={errors.tagline} hint="One short line, e.g. “Fresh bread every morning since 2015”.">
          <Input {...text("tagline")} />
        </Field>
        <Field label="What your company does" required error={errors.about} hint="In a few sentences: what you sell or do, for whom, and what makes you different. The more concrete, the better the posts.">
          <Textarea rows={6} value={values.about} maxLength={PROFILE_LIMITS.about} placeholder="We run a family bakery in Kimironko. We bake bread, cakes and pastries every morning and deliver to offices and homes in Kigali…" onChange={(e) => set("about", e.target.value)} />
        </Field>
        <IndustryFields
          industries={industries}
          values={{ industry: values.industry, industryOther: values.industryOther, industryDescription: values.industryDescription }}
          errors={errors}
          onChange={(key, value) => set(key, value)}
          compact
        />
      </GlassCard>

      <GlassCard as="section" aria-labelledby="profile-purpose" className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 id="profile-purpose" className="text-lg font-semibold tracking-[-0.02em]">
          Mission, vision and values
        </h2>
        <Field label="Mission" error={errors.mission} hint="Why you exist, e.g. “Affordable, healthy meals for busy families”.">
          <Textarea rows={3} {...text("mission")} />
        </Field>
        <Field label="Vision" error={errors.vision} hint="Where you are heading, e.g. “The first bakery people think of in Kigali”.">
          <Textarea rows={3} {...text("vision")} />
        </Field>
        <ListField label="Values" items={values.values} onChange={(v) => set("values", v)} max={MAX_VALUES} each={PROFILE_LIMITS.value} placeholder="Honesty" hint="A word or two each. Press Enter to add." error={errors.values} />
        <ListField
          label="Achievements and certifications"
          items={values.achievements}
          onChange={(v) => set("achievements", v)}
          max={MAX_ACHIEVEMENTS}
          each={PROFILE_LIMITS.achievement}
          placeholder="Rwanda Standards Board S-Mark, 2024"
          hint="Optional. Only what you can show: BuPulse states these exactly as written."
          error={errors.achievements}
        />
      </GlassCard>

      <GlassCard as="section" aria-labelledby="profile-company" className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 id="profile-company" className="text-lg font-semibold tracking-[-0.02em]">
          Company details
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Year founded" error={errors.yearFounded}>
            <Input inputMode="numeric" value={values.yearFounded} maxLength={4} placeholder="2019" onChange={(e) => set("yearFounded", e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Company size" error={errors.size}>
            <Select value={values.size} onChange={(e) => set("size", e.target.value)}>
              <option value="">Choose…</option>
              {COMPANY_SIZES.map((s) => (
                <option key={s} value={s}>
                  {SIZE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Legal name" error={errors.legalName} hint="Optional, if different from the name above.">
            <Input {...text("legalName")} />
          </Field>
          <Field label="Registration number or TIN" error={errors.registrationNumber} hint="Optional, e.g. your RDB company code or RRA TIN.">
            <Input {...text("registrationNumber")} />
          </Field>
          <Field label="Website" error={errors.website}>
            <Input type="url" inputMode="url" value={values.website} placeholder="yourbusiness.com" onChange={(e) => set("website", e.target.value)} />
          </Field>
          <Field label="Area you serve" error={errors.serviceArea} hint="Also used by your chat assistant, e.g. “Kigali and nearby”.">
            <Input {...text("serviceArea")} />
          </Field>
        </div>
        <ListField label="Languages you serve customers in" items={values.languages} onChange={(v) => set("languages", v)} max={MAX_LANGUAGES} each={PROFILE_LIMITS.language} placeholder="Another language" suggestions={COMMON_LANGUAGES} error={errors.languages} />
      </GlassCard>

      {formError && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] font-medium text-danger">
          {formError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted">
          {saved && (
            <>
              <Check aria-hidden className="size-4 text-success" /> Saved
            </>
          )}
        </span>
      </div>
    </form>
  );
}
