"use client";

import { useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { Button, useToast, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { loadComposerContextAction } from "@/app/dashboard/calendar/actions";
import type { ComposerContext, ComposerPrefill } from "@/lib/publishing/types";
import { PostComposer } from "./composer";

/** "Schedule": opens the composer with this content filled in. Loads the accounts the first time it is pressed. */
export function ScheduleButton({
  prefill,
  label = "Schedule",
  variant = "outline",
  size = "sm",
  className,
}: {
  prefill: ComposerPrefill;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { toast } = useToast();
  const [context, setContext] = useState<ComposerContext | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function start() {
    if (context) return setOpen(true);
    startTransition(async () => {
      const res = await loadComposerContextAction();
      if (!res.ok) return toast(res.error, "error");
      setContext(res.context);
      setOpen(true);
    });
  }

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={start} disabled={pending} leading={<CalendarClock aria-hidden className="size-4" />}>
        {pending ? "Opening..." : label}
      </Button>
      {context && <PostComposer open={open} onOpenChange={setOpen} context={context} prefill={prefill} />}
    </>
  );
}
