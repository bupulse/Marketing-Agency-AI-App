"use client";

import { PenLine } from "lucide-react";
import { Button } from "@/components/ui";
import { GenerateProgress } from "@/components/studio/generate-progress";
import { useGenerate } from "@/components/studio/use-generate";

/** "Generate posts for this product": writes the content (1 text credit) and BuPulse drafts a post for each app. */
export function GeneratePostsButton({ subjectId, label }: { subjectId: string; label: string }) {
  const { run, pending, dialog } = useGenerate(subjectId);
  return (
    <div className="flex flex-col items-center gap-3">
      {pending ? (
        <GenerateProgress />
      ) : (
        <Button size="lg" onClick={() => run()} leading={<PenLine aria-hidden className="size-5" />}>
          {label}
        </Button>
      )}
      {dialog}
    </div>
  );
}
