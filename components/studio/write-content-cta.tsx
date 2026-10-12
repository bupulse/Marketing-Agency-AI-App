"use client";

import { PenLine } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { GenerateProgress } from "./generate-progress";
import { useGenerate } from "./use-generate";
import { usageNote } from "./helpers";

/** Shown on a product or campaign that has no content yet. */
export function WriteContentCta({ subjectId, used, limit }: { subjectId: string; used?: number; limit?: number }) {
  const { run, pending, dialog } = useGenerate(subjectId, { limit });

  return (
    <GlassCard as="section" aria-labelledby="write-content" padding="lg" className="flex flex-col items-center gap-4 text-center">
      {pending ? (
        <GenerateProgress />
      ) : (
        <>
          <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-brand-gradient text-white shadow-glow">
            <PenLine aria-hidden className="size-7" />
          </span>
          <div className="flex max-w-md flex-col gap-1.5">
            <h2 id="write-content" className="text-xl font-semibold tracking-[-0.02em]">
              No content yet
            </h2>
            <p className="text-[15px] text-muted">
              BuPulse writes a caption, hashtags, a 30-second video script and ad headlines in your brand voice.
            </p>
          </div>
          <Button size="lg" onClick={() => run()} leading={<PenLine aria-hidden className="size-5" />}>
            Write content
          </Button>
          <p className="text-[13px] text-muted">{usageNote(used, limit)}</p>
        </>
      )}
      {dialog}
    </GlassCard>
  );
}
