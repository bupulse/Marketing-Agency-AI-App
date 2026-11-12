import { getAppContext } from "@/components/app/context";
import { KnowledgeHub, type HubSection } from "@/components/knowledge/knowledge-hub";
import { quizEntry } from "@/lib/knowledge/quiz-entry";
import { KNOWLEDGE_SECTIONS, toReachFull } from "@/lib/knowledge/sections";
import { can } from "@/lib/team/roles";

export const metadata = { title: "Business info" };

export default async function KnowledgePage() {
  const { business, role, entitlements } = await getAppContext();
  const entry = await quizEntry(business, role, entitlements.usable);
  const { progress } = entry;
  // Members get no purchase prompts (lib/team/roles.ts upgrade).
  const canUpgrade = can(role, "upgrade");
  const allowed = (s: (typeof KNOWLEDGE_SECTIONS)[number]) => (!s.permission || can(role, s.permission)) && (!s.feature || entitlements.usable.has(s.feature));

  const sections: HubSection[] = KNOWLEDGE_SECTIONS.map((s) => {
    const p = progress[s.key];
    const missingFeature = Boolean(s.feature && !entitlements.usable.has(s.feature));
    const viewOnly = Boolean(s.permission && !can(role, s.permission));
    return {
      key: s.key,
      title: s.title,
      description: s.description,
      href: s.href,
      soon: s.status === "coming_soon",
      lock: missingFeature ? (canUpgrade ? "add" : "missing") : viewOnly ? "view" : null,
      percent: typeof p?.percent === "number" ? p.percent : null,
      summary: p?.summary,
    };
  });

  return <KnowledgeHub entry={entry} sections={sections} todos={toReachFull(progress, allowed, 4)} />;
}
