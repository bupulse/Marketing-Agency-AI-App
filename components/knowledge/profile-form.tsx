"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ClipboardList, Target } from "lucide-react";
import { Button, Field, Input, Textarea, useToast } from "@/components/ui";
import { BPanel } from "@/components/app/kit/b-cards";
import { BChoice } from "@/components/app/kit/b-choice";
import { BSteps, type BStep } from "@/components/app/kit/b-steps";
import { IndustryFields } from "@/components/auth/industry-fields";
import { saveProfile } from "@/app/dashboard/knowledge/profile/actions";
import type { IndustryOption } from "@/lib/industries/shared";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { COMMON_LANGUAGES, COMPANY_SIZES, MAX_ACHIEVEMENTS, MAX_LANGUAGES, MAX_VALUES, PROFILE_LIMITS, profileInputSchema, SIZE_LABEL, type CompanySize, type ProfileFormValues, type ProfileInput } from "@/lib/knowledge/profile";
import { ListField } from "./list-field";

const STEPS: BStep[] = [
  { id: "basics", title: "The basics", icon: Building2 },
  { id: "purpose", title: "Mission and values", icon: Target },
  { id: "company", title: "Company details", icon: ClipboardList },
];
/** Tap-to-add ideas for Values (the same everyday words the quiz offers). */
const VALUE_IDEAS = ["Honesty", "Quality", "Respect for customers", "Reliability", "Fast service", "Community"];
/** Which step each field is on, so a check that fails opens the step with the first highlighted field. */
const STEP_OF: Record<string, number> = { name: 0, tagline: 0, about: 0, industry: 0, industryOther: 0, industryDescription: 0, mission: 1, vision: 1, values: 1, achievements: 1 };

/** Knowledge base -> Company profile. Checked in the browser with the server's schema, then saved by saveProfile. */
export function ProfileForm({ industries, initial }: { industries: IndustryOption[]; initial: ProfileFormValues }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [step, setStep] = useState(0);
  // Opens the step holding the first field with an error, then focuses it once it shows.
  function showErrors(found: Record<string, string>) {
    const keys = Object.keys(found).filter((k) => found[k]);
    if (keys.length === 0) return;
    setStep(Math.min(...keys.map((k) => STEP_OF[k] ?? 2)));
    setTimeout(() => document.querySelector<HTMLElement>("[aria-invalid=true]:not([hidden] *)")?.focus(), 50);
  }

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
      showErrors(found);
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
      if (result.fieldErrors) {
        setErrors(result.fieldErrors);
        showErrors(result.fieldErrors);
      }
      setFormError(result.error);
    });
  }

  const text = (key: "tagline" | "mission" | "vision" | "legalName" | "registrationNumber" | "serviceArea") => ({
    value: values[key],
    maxLength: PROFILE_LIMITS[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value),
  });


  const finish = (
    <>
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
    </>
  );

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {formError && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] font-medium text-danger">
          {formError}
        </p>
      )}
      <BSteps label="Company profile steps" steps={STEPS} at={step} onAt={setStep} finish={finish}>
        <BPanel id="profile-basics" icon={Building2} title="The basics" hint="Your name, one line about you and what you do.">
          <Field label="Company name" required error={errors.name} hint="As customers know you.">
            <Input value={values.name} maxLength={PROFILE_LIMITS.name} autoComplete="organization" onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Tagline" error={errors.tagline} hint="One short line, e.g. “Fresh bread every morning since 2015”.">
            <Input {...text("tagline")} />
          </Field>
          <Field label="What your company does" required error={errors.about} hint="In a few sentences: what you sell or do, for whom, and what makes you different.">
            <Textarea rows={5} value={values.about} maxLength={PROFILE_LIMITS.about} placeholder="We run a family bakery in Kimironko. We bake bread, cakes and pastries every morning and deliver to offices and homes in Kigali…" onChange={(e) => set("about", e.target.value)} />
          </Field>
          <IndustryFields
            industries={industries}
            values={{ industry: values.industry, industryOther: values.industryOther, industryDescription: values.industryDescription }}
            errors={errors}
            onChange={(key, value) => set(key, value)}
            compact
          />
        </BPanel>

        <BPanel id="profile-purpose" icon={Target} title="Mission, vision and values" hint="All optional. Short answers are best.">
          <Field label="Mission" error={errors.mission} hint="Why you exist, e.g. “Affordable, healthy meals for busy families”.">
            <Textarea rows={2} {...text("mission")} />
          </Field>
          <Field label="Vision" error={errors.vision} hint="Where you are heading, e.g. “The first bakery people think of in Kigali”.">
            <Textarea rows={2} {...text("vision")} />
          </Field>
          <ListField label="Values" items={values.values} onChange={(v) => set("values", v)} max={MAX_VALUES} each={PROFILE_LIMITS.value} placeholder="Honesty" hint="Tap one or type your own. Press Enter to add." suggestions={VALUE_IDEAS} error={errors.values} />
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
        </BPanel>

        <BPanel id="profile-company" icon={ClipboardList} title="Company details" hint="Tap your size; the rest is optional.">
          <BChoice
            legend="Company size"
            options={COMPANY_SIZES.map((s) => ({ value: s, label: SIZE_LABEL[s] }))}
            value={values.size as CompanySize | ""}
            onChange={(v) => set("size", v)}
            allowNone
            error={errors.size}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Year founded" error={errors.yearFounded}>
              <Input inputMode="numeric" value={values.yearFounded} maxLength={4} placeholder="2019" onChange={(e) => set("yearFounded", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Website" error={errors.website}>
              <Input type="url" inputMode="url" value={values.website} placeholder="yourbusiness.com" onChange={(e) => set("website", e.target.value)} />
            </Field>
            <Field label="Area you serve" error={errors.serviceArea} hint="Also used by your chat assistant, e.g. “Kigali and nearby”.">
              <Input {...text("serviceArea")} />
            </Field>
            <Field label="Legal name" error={errors.legalName} hint="Optional, if different from your company name.">
              <Input {...text("legalName")} />
            </Field>
            <Field label="Registration number or TIN" error={errors.registrationNumber} hint="Optional, e.g. your RDB company code or RRA TIN.">
              <Input {...text("registrationNumber")} />
            </Field>
          </div>
          <ListField label="Languages you serve customers in" items={values.languages} onChange={(v) => set("languages", v)} max={MAX_LANGUAGES} each={PROFILE_LIMITS.language} placeholder="Another language" suggestions={COMMON_LANGUAGES} error={errors.languages} />
        </BPanel>
      </BSteps>
    </form>
  );
}
