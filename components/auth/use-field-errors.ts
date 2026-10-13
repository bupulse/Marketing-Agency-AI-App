"use client";

import { useState } from "react";

/** Pure: the error to show for a field: the server's, unless the person has typed in that field since. */
export function shownError(errors: Partial<Record<string, string>> | undefined, edited: ReadonlySet<string>, field: string): string | undefined {
  return edited.has(field) ? undefined : errors?.[field] || undefined;
}

/**
 * Field errors from a server action's state that go away as soon as the person edits the field, so a fixed email no
 * longer shows "Enter a valid email address." until the next submit. Put `onInput={edit}` on the form.
 */
export function useFieldErrors<S>(state: S, errors: Partial<Record<string, string>> | undefined) {
  const [seen, setSeen] = useState<{ state: S; edited: Set<string> }>({ state, edited: new Set() });
  // A new answer from the server brings fresh errors (adjusted while rendering, as the sign-up form does).
  if (seen.state !== state) setSeen({ state, edited: new Set() });
  const edited = seen.state === state ? seen.edited : new Set<string>();
  return {
    error: (field: string) => shownError(errors, edited, field),
    edit: (event: { target: EventTarget | null }) => {
      const name = (event.target as HTMLInputElement | null)?.name;
      if (!name || !errors?.[name] || edited.has(name)) return;
      setSeen((s) => ({ ...s, edited: new Set(s.edited).add(name) }));
    },
  };
}
