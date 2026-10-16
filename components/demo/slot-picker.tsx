"use client";

import { CalendarCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatSlotTime } from "@/lib/demo/slots";
import { bookDemoAction, type BookDemoState } from "@/app/book-demo/actions";

type Group = { ymd: string; label: string; slots: string[] };
type Labels = { book: string; move: string; empty: string };

const DEMO_LABELS: Labels = { book: "Book this time", move: "Move my demo to this time", empty: "No free times in the next two weeks. Reply to your welcome email and we will find one together." };

/**
 * Step 2 of /book-demo: free slots grouped by day. The chosen start time is sent as an ISO instant. The custom plan
 * call (/custom-plan/call) uses it too, with its own action, labels and hidden fields.
 */
export function SlotPicker({ groups, timeZone, rescheduling, action = bookDemoAction, labels = DEMO_LABELS, hidden = {} }: { groups: Group[]; timeZone: string; rescheduling: boolean; action?: (prev: BookDemoState, formData: FormData) => Promise<BookDemoState>; labels?: Labels; hidden?: Record<string, string> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<BookDemoState, FormData>(action, {});

  if (groups.length === 0) {
    return <p className="rounded-2xl bg-soft px-4 py-6 text-center text-[15px] text-muted">{labels.empty}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <input type="hidden" name="startsAt" value={selected ?? ""} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <fieldset key={g.ymd} className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{g.label}</legend>
            <div className="flex flex-wrap gap-2">
              {g.slots.map((iso) => {
                const on = selected === iso;
                return (
                  <button
                    key={iso}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSelected(iso)}
                    className={cn(
                      "inline-flex min-h-11 min-w-[5.5rem] cursor-pointer items-center justify-center rounded-full border px-4 text-sm font-semibold tabular-nums transition-colors",
                      on ? "border-pulse-violet bg-pulse-violet text-white" : "border-line hover:bg-soft",
                    )}
                  >
                    {formatSlotTime(new Date(iso), timeZone)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <Button type="submit" size="lg" disabled={pending || !selected} leading={<CalendarCheck aria-hidden className="size-[18px]" />}>
        {pending ? "Booking…" : rescheduling ? labels.move : labels.book}
      </Button>
      <p className="text-xs text-muted">You get an email with the meeting link and a calendar invite. You can reschedule or cancel up to 2 hours before the call.</p>
    </form>
  );
}
