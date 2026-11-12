// Made-up data for the client preview (app/preview-b, development only). Placeholder names, numbers and links only.
import type { ReactNode } from "react";
import { KnowledgeHub, type HubSection } from "@/components/knowledge/knowledge-hub";
import { KNOWLEDGE_SECTIONS, toReachFull, type SectionProgress, type SectionKey } from "@/lib/knowledge/sections";
import type { QuizEntry } from "@/lib/knowledge/quiz-entry";

type Sp = Record<string, string | string[] | undefined>;

const PROGRESS: Partial<Record<SectionKey, SectionProgress>> = {
  profile: { percent: 80, summary: "Mission and values to add", next: "Add your mission" },
  products: { percent: 60, summary: "12 products · 5 without photos", next: "Add photos to 5 products" },
  campaigns: { percent: 100, summary: "2 campaigns coming up" },
  locations: { percent: 50, summary: "1 location · hours missing", next: "Add your opening hours" },
  brand: { percent: 100, summary: "Logo and 3 colours" },
  channels: { percent: 40, summary: "2 of 5 channels connected", next: "Connect TikTok" },
  audience: { percent: 30, summary: "1 customer type", next: "Describe what your customers need" },
  competitors: { percent: 0, summary: "Nothing yet", next: "Add 2 competitors" },
  faqs: { percent: 70, summary: "8 answers" },
  reviews: { percent: 20, summary: "1 review", next: "Add 2 more reviews" },
  interview: { percent: null, summary: "Not started" },
};

function knowledge(): ReactNode {
  const entry: QuizEntry = { progress: PROGRESS, overall: 55, playable: true, href: "/dashboard/knowledge/quiz?round=you", label: "Continue", nextRound: { emoji: "🏪", title: "About you" }, done: false };
  const sections: HubSection[] = KNOWLEDGE_SECTIONS.map((s) => ({
    key: s.key,
    title: s.title,
    description: s.description,
    href: s.href,
    soon: s.status === "coming_soon",
    lock: s.key === "interview" ? "add" : null,
    percent: PROGRESS[s.key]?.percent ?? null,
    summary: PROGRESS[s.key]?.summary,
  }));
  return <KnowledgeHub entry={entry} sections={sections} todos={toReachFull(PROGRESS, () => true, 4)} />;
}

export const PREVIEW_B_SCREENS: Record<string, (sp: Sp) => ReactNode | Promise<ReactNode>> = {
  knowledge,
};
