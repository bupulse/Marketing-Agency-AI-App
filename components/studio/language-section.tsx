"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button, Field, GlassCard, Select, useToast } from "@/components/ui";
import { CONTENT_LANGUAGES } from "@/lib/brand/languages";
import { saveContentLanguage } from "@/app/dashboard/brand/language-action";

/** Which language BuPulse writes in. Saves on its own, like the other Brand cards. */
export function LanguageSection({ initial }: { initial: string }) {
  const [language, setLanguage] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useToast();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const result = await saveContentLanguage(language);
      if (result.ok) {
        setSaved(true);
        toast("Content language saved.", "success");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <GlassCard as="section" aria-labelledby="brand-language" className="p-5 sm:p-6">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id="brand-language" className="text-lg font-semibold tracking-[-0.02em]">
            Content language
          </h2>
          <p className="text-[14px] text-muted">The language captions, scripts and headlines are written in.</p>
        </div>
        <Field label="Language" error={error ?? undefined} className="max-w-sm">
          <Select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setSaved(false);
            }}
          >
            {CONTENT_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
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
    </GlassCard>
  );
}
