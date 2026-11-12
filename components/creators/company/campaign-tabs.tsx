import Link from "next/link";
import { BarChart3, Banknote, Film, ListChecks, Settings, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/cn";

export const CAMPAIGN_TABS = [
  { id: "overview", path: "", label: "Overview", icon: BarChart3 },
  { id: "tasks", path: "/tasks", label: "Tasks", icon: ListChecks },
  { id: "applicants", path: "/applicants", label: "Applicants", icon: UserPlus },
  { id: "creators", path: "/creators", label: "Creators", icon: Users },
  { id: "posts", path: "/posts", label: "Posts", icon: Film },
  { id: "payouts", path: "/payouts", label: "Payouts", icon: Banknote },
  { id: "settings", path: "/settings", label: "Settings", icon: Settings },
] as const;
export type CampaignTab = (typeof CAMPAIGN_TABS)[number]["id"];

/** The campaign's sections, one page each; scrolls sideways on a phone. */
export function CampaignTabs({ campaignId, current, applied }: { campaignId: string; current: CampaignTab; /** Applicants waiting for an answer: a count on the tab. */ applied: number }) {
  return (
    <nav aria-label="Campaign sections" className="-mx-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
      <ul className="flex w-max gap-2">
        {CAMPAIGN_TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              href={`/dashboard/creators/${campaignId}${tab.path}`}
              aria-current={tab.id === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 text-[14.5px] font-semibold no-underline transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
                tab.id === current ? "border-transparent bg-brand-gradient text-white shadow-glow" : "border-line bg-surface text-muted hover:border-pulse-blue/40 hover:text-text dark:bg-white/[0.03]",
              )}
            >
              <tab.icon aria-hidden className="size-4" />
              {tab.label}
              {tab.id === "applicants" && applied > 0 && (
                <span className={cn("rounded-full px-1.5 text-[12px] leading-5", tab.id === current ? "bg-white/25" : "bg-danger text-white")}>
                  {applied}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
