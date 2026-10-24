import { CalendarClock, ChevronRight, Clapperboard, Film, MessageSquareText, Paintbrush, Palette, PenLine, ScanSearch, Scissors, Search, type LucideIcon } from "lucide-react";
import { AGENTS, agentById, type AgentId } from "@/lib/training-lab/agents";
import { POST_PIPELINE, REEL_PIPELINE } from "./view";

export const AGENT_ICONS: Record<AgentId, LucideIcon> = {
  researcher: Search,
  director: Clapperboard,
  "script-writer": PenLine,
  designer: Palette,
  "caption-writer": MessageSquareText,
  painter: Paintbrush,
  filmmaker: Film,
  editor: Scissors,
  checker: ScanSearch,
  scheduler: CalendarClock,
};

/** A round icon with the member's name; a tap scrolls to its card below. */
function Step({ id }: { id: AgentId }) {
  const Icon = AGENT_ICONS[id];
  return (
    <a href={`#agent-${id}`} className="flex min-h-11 w-[4.5rem] flex-col items-center gap-1 rounded-xl py-1 text-center no-underline hover:bg-soft">
      <span className="flex size-11 items-center justify-center rounded-full bg-brand-gradient text-white shadow-glow">
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="text-[12px] leading-tight font-medium text-text">{agentById(id)?.name ?? id}</span>
    </a>
  );
}

function Row({ label, ids }: { label: string; ids: AgentId[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <ol className="flex min-w-0 flex-wrap items-start gap-y-2">
        {ids.map((id, i) => (
          <li key={id} className="flex items-center">
            {i > 0 && <ChevronRight aria-hidden className="mx-0.5 size-4 shrink-0 text-muted" />}
            <Step id={id} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** How a reel and a post are made, step by step, at the top of the Team page. */
export function Pipeline() {
  if (AGENTS.length === 0) return null;
  return (
    <section aria-label="How a reel or post is made" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4">
      <Row label="A reel is made by" ids={REEL_PIPELINE} />
      <Row label="A post adds" ids={POST_PIPELINE} />
    </section>
  );
}
