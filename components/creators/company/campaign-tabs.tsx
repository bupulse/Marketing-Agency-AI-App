import Link from "next/link";
import { cn } from "@/lib/cn";

export const CAMPAIGN_TABS = [
  { id: "overview", path: "", label: "Overview" },
  { id: "tasks", path: "/tasks", label: "Tasks" },
  { id: "applicants", path: "/applicants", label: "Applicants" },
  { id: "creators", path: "/creators", label: "Creators" },
  { id: "posts", path: "/posts", label: "Posts" },
  { id: "payouts", path: "/payouts", label: "Payouts" },
  { id: "settings", path: "/settings", label: "Settings" },
] as const;
export type CampaignTab = (typeof CAMPAIGN_TABS)[number]["id"];

/** The campaign's sections, one page each; scrolls sideways on a phone. */
export function CampaignTabs({ campaignId, current, applied }: { campaignId: string; current: CampaignTab; /** Applicants waiting for an answer: a count on the tab. */ applied: number }) {
  return (
    <nav aria-label="Campaign sections" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex w-max gap-2">
        {CAMPAIGN_TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              href={`/dashboard/creators/${campaignId}${tab.path}`}
              aria-current={tab.id === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold no-underline transition-colors",
                tab.id === current ? "bg-brand-gradient text-white shadow-glow" : "text-muted hover:bg-soft hover:text-text",
              )}
            >
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
