import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { Badge, GlassCard } from "@/components/ui";
import { formatWhen, typeLabel } from "./helpers";

export type ProjectCardData = {
  id: string;
  type: string;
  title: string;
  price: string | null;
  thumb: string | null;
  contentCount: number;
  designCount: number;
  lastGenerated: string | null;
};

export function ProjectGrid({ projects }: { projects: ProjectCardData[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {projects.map((p) => (
        <li key={p.id}>
          <Link href={`/dashboard/projects/${p.id}`} className="block h-full no-underline">
            <GlassCard interactive padding="none" className="flex h-full flex-col overflow-hidden">
              <div className="relative aspect-[4/3] bg-soft">
                {p.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private signed URL
                  <img src={p.thumb} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span aria-hidden className="flex size-full items-center justify-center bg-brand-gradient text-white/80">
                    <ImageIcon className="size-8" />
                  </span>
                )}
                <Badge tone="blue" className="absolute top-3 left-3 bg-glass-strong">
                  {typeLabel(p.type)}
                </Badge>
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <strong className="line-clamp-2 text-[16px] leading-snug">{p.title}</strong>
                {p.price && <span className="truncate text-[14px] text-muted">{p.price}</span>}
                <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-2 text-[13px] text-muted">
                  <span>{p.contentCount} {p.contentCount === 1 ? "text" : "texts"}</span>
                  <span>{p.designCount} {p.designCount === 1 ? "design" : "designs"}</span>
                  <span>{p.lastGenerated ? `Written ${formatWhen(p.lastGenerated)}` : "No content yet"}</span>
                </div>
              </div>
            </GlassCard>
          </Link>
        </li>
      ))}
    </ul>
  );
}
