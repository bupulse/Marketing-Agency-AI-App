"use client";

import { TriangleAlert } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <GlassCard padding="lg" role="alert" className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-danger-bg text-danger">
        <TriangleAlert aria-hidden className="size-8" />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Something went wrong</h1>
        <p className="text-[15px] text-muted">
          We could not load this page. Your work is safe. Try again, and if it keeps happening, contact support.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button href="/dashboard" variant="ghost">Back to home</Button>
      </div>
    </GlassCard>
  );
}
