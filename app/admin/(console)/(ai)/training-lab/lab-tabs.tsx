import Link from "next/link";
import { BookOpen, Clapperboard, Film, Languages, Plus, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { FOCUS } from "@/components/admin/kit";

export const LAB_TABS = [
  { key: "library", href: "/admin/training-lab", label: "Library", icon: BookOpen, hint: "Every example, with its notes and rating." },
  { key: "add", href: "/admin/training-lab/add", label: "Add", icon: Plus, hint: "Drop a reel, video, photo or voice note; the AI fills in the form." },
  { key: "reels", href: "/admin/training-lab/reels", label: "Finished reels", icon: Film, hint: "The newest reels the engine made: more like this, or never this." },
  { key: "team", href: "/admin/training-lab/team", label: "Team", icon: Users, hint: "The studio team: who does which job, and on which brain." },
  { key: "editor", href: "/admin/training-lab/editor", label: "Editor", icon: Clapperboard, hint: "Edit a video, export the MP4 or save it as an example." },
  { key: "words", href: "/admin/training-lab/words", label: "Words", icon: Languages, hint: "What the Lab teaches about Kinyarwanda, from your recordings." },
] as const satisfies readonly { key: string; href: string; label: string; icon: LucideIcon; hint: string }[];

/** The parts of the Training Lab as chips, at the top of each of its pages; scrolls sideways on a phone. */
export function LabTabs({ current }: { current: (typeof LAB_TABS)[number]["key"] }) {
  return (
    <nav aria-label="Training Lab" className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      <ul className="flex w-max gap-2">
        {LAB_TABS.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={current === t.key ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border-2 px-3.5 text-[13px] font-semibold no-underline transition-colors duration-200 motion-reduce:transition-none",
                FOCUS,
                current === t.key ? "border-pulse-violet bg-pulse-violet/[0.08] text-text dark:bg-pulse-violet/20" : "border-line bg-surface text-muted hover:border-pulse-violet/40 hover:text-text dark:bg-white/[0.03]",
              )}
            >
              <t.icon aria-hidden className="size-3.5" />
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
