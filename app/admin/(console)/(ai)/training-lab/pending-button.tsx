"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

/** A submit button that says it is working while its form's action runs, so a slow save (copying a reel's video) is never mistaken for a dead button, and cannot be pressed twice. */
export function PendingButton({ label, pendingLabel = "Saving…" }: { label: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> {pendingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}
