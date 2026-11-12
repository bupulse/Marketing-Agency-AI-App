"use client";

import { useState, useTransition } from "react";
import { Check, Languages } from "lucide-react";
import { BPanel } from "@/components/app/kit/b-cards";
import { BChoice } from "@/components/app/kit/b-choice";
import { Button, useToast } from "@/components/ui";
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
    <BPanel id="brand-language" icon={Languages} tone="violet" title="Content language" hint="The language captions, scripts and headlines are written in.">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <BChoice
          legend="Language"
          hideLegend
          options={CONTENT_LANGUAGES.map((l) => ({ value: l, label: l }))}
          value={language}
          onChange={(v) => {
            if (!v) return;
            setLanguage(v);
            setSaved(false);
          }}
          error={error ?? undefined}
        />
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
    </BPanel>
  );
}
