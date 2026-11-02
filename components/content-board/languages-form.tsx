"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, GlassCard, useToast } from "@/components/ui";
import { saveContentLanguagesAction } from "@/app/dashboard/content/actions";
import type { ContentLanguage } from "@/lib/brand/languages";
import { choiceLanguages, LANGUAGE_OPTIONS, MAX_MIX, type ContentLanguages, type LanguageChoice, type LanguagePart } from "@/lib/content-languages/settings";
import { needsApprovedVoice, noVoiceNote } from "@/lib/content-languages/voice";

const PARTS: { part: LanguagePart; title: string; hint: string }[] = [
  { part: "images", title: "Pictures and captions", hint: "The words on the picture and the post's caption." },
  { part: "videos", title: "Daily videos", hint: "The voice-over, the subtitles and the caption." },
  { part: "skits", title: "Talking skits", hint: "What the people in the skit say." },
];

/** "Languages": one language or a mix for pictures, daily videos and talking skits. Read-only for Members. */
export function LanguagesForm({
  initial,
  noVoice,
  canEdit,
  askText,
}: {
  initial: ContentLanguages;
  /** Languages BuPulse has no approved voice for yet (their videos get no voice-over). */
  noVoice: string[];
  canEdit: boolean;
  askText: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [languages, setLanguages] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(languages) !== JSON.stringify(initial);
  const locked = !canEdit || pending;
  const set = (part: LanguagePart, choice: LanguageChoice) => setLanguages((l) => ({ ...l, [part]: choice }));

  function setMode(part: LanguagePart, mode: LanguageChoice["mode"]) {
    const current = choiceLanguages(languages[part]);
    if (mode === "one") return set(part, { mode: "one", language: current[0] });
    // A new mix starts with the current language and English (or Kinyarwanda when that is English).
    const second: ContentLanguage = current[0] === "English" ? "Kinyarwanda" : "English";
    set(part, { mode: "mix", languages: current.length > 1 ? current : [current[0], second] });
  }

  function toggle(part: LanguagePart, language: ContentLanguage, on: boolean) {
    const choice = languages[part];
    if (choice.mode !== "mix") return;
    if (on && choice.languages.length >= MAX_MIX) return toast(`A mix has up to ${MAX_MIX} languages. Turn one off first.`, "error");
    if (!on && choice.languages.length <= 2) return toast("A mix needs at least two languages. Choose one language instead.", "error");
    const next = on ? [...choice.languages, language] : choice.languages.filter((l) => l !== language);
    set(part, { mode: "mix", languages: LANGUAGE_OPTIONS.filter((l) => next.includes(l)) });
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveContentLanguagesAction(languages);
      if (!res.ok) return setError(res.error);
      toast("Saved. New posts follow these languages.", "success");
      router.refresh();
    });
  }

  return (
    <GlassCard as="section" aria-labelledby="languages-heading" padding="lg" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 id="languages-heading" className="text-xl font-semibold tracking-[-0.02em]">
          Languages
        </h2>
        <p className="text-[15px] text-muted">
          Choose the language of each kind of post. With a mix, BuPulse picks one language for each post and day, for example English one day and Kinyarwanda the next. One post is never in two languages.
        </p>
      </div>

      {PARTS.map(({ part, title, hint }) => {
        const choice = languages[part];
        const silent = part === "videos" ? choiceLanguages(choice).filter((l) => needsApprovedVoice(l) && noVoice.includes(l)) : [];
        return (
          <fieldset key={part} className="flex flex-col gap-2 border-t border-line pt-5">
            <legend className="text-[15px] font-semibold">{title}</legend>
            <p className="text-[13px] text-muted">{hint}</p>
            <div className="flex flex-wrap gap-x-5">
              {(
                [
                  ["one", "One language"],
                  ["mix", "Mix of languages"],
                ] as const
              ).map(([mode, label]) => (
                <label key={mode} className="flex min-h-11 cursor-pointer items-center gap-2 text-[15px]">
                  <input type="radio" name={`language-mode-${part}`} className="size-5" checked={choice.mode === mode} disabled={locked} onChange={() => setMode(part, mode)} />
                  {label}
                </label>
              ))}
            </div>
            {choice.mode === "one" ? (
              <select
                aria-label={`${title}: language`}
                value={choice.language}
                disabled={locked}
                onChange={(e) => set(part, { mode: "one", language: e.target.value as ContentLanguage })}
                className="min-h-12 w-full max-w-xs cursor-pointer rounded-2xl border border-line bg-glass px-4 text-[15px]"
              >
                {LANGUAGE_OPTIONS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {LANGUAGE_OPTIONS.map((l) => (
                  <li key={l}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
                      <input type="checkbox" className="size-5" checked={choice.languages.includes(l)} disabled={locked} onChange={(e) => toggle(part, l, e.target.checked)} />
                      {l}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {silent.map((l) => (
              <p key={l} className="rounded-2xl bg-soft p-3 text-[13px] text-muted">
                {noVoiceNote(l)}
              </p>
            ))}
          </fieldset>
        );
      })}

      {error && (
        <p role="alert" className="text-[14px] font-medium text-danger">
          {error}
        </p>
      )}
      {canEdit ? (
        <div>
          <Button onClick={save} disabled={pending || !changed}>
            {pending ? "Saving..." : "Save languages"}
          </Button>
        </div>
      ) : (
        <p className="text-[14px] text-muted">{askText}</p>
      )}
    </GlassCard>
  );
}
