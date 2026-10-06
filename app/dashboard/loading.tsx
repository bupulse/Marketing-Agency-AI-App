import { GlassCard, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 px-1">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <GlassCard key={i} className="flex flex-col gap-3 rounded-card p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-28" />
          </GlassCard>
        ))}
      </div>
      <GlassCard className="flex flex-col gap-4 p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </GlassCard>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
