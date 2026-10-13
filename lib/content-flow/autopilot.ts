// Autopilot on the content packs' angles (docs/CONTENT.md, docs/CONTENT_PACKS.md): every week's post about a product or
// campaign gets the next angle of that subject's rotation (lib/studio/angles.ts chooseAngles, the history the packs and
// "Create today's content" write), plus the day's opening and structure (variety.ts), so it reads differently from the
// subject's other posts. Autopilot's own idea stays the post's purpose.
import "server-only";
import { logError } from "@/lib/errors";
import { ANGLES, chooseAngles, type AngleId } from "@/lib/studio/angles";
import { angleFacts, recentAngles } from "@/lib/studio/pack";
import { dayVariety } from "./variety";

export type AutopilotAngle = { id: AngleId; label: string; brief: string; hook: string; structure: string };
export type AngleGroup = { groupId: string; day: string; project?: { id: string; subject?: "product" | "campaign"; type: string; price: string | null } };

/** The angle of every group about a product or campaign, in day order, each choice counted for the next ones. */
export async function planAutopilotAngles(businessId: string, groups: AngleGroup[], country: string | null, now: Date): Promise<Map<string, AutopilotAngle>> {
  const out = new Map<string, AutopilotAngle>();
  const withProject = groups.filter((g) => g.project).sort((a, b) => a.day.localeCompare(b.day));
  try {
    const history = new Map<string, string[]>();
    const facts = new Map<string, Awaited<ReturnType<typeof angleFacts>>>();
    for (const g of withProject) {
      const p = g.project!;
      const subject = { kind: p.subject ?? ("product" as const), id: p.id };
      const key = `${subject.kind}:${p.id}`;
      if (!history.has(key)) history.set(key, await recentAngles(businessId, subject));
      if (!facts.has(key)) facts.set(key, await angleFacts(businessId, subject, { type: p.type, price: p.price }, country, now));
      const recent = history.get(key)!;
      const [id] = chooseAngles(facts.get(key)!, recent, 1);
      if (!id) continue;
      recent.unshift(id);
      const variety = dayVariety(key, g.day);
      out.set(g.groupId, { id, label: ANGLES[id].label, brief: ANGLES[id].brief, ...variety });
    }
  } catch (error) {
    // Angles only add variety: Autopilot writes without them rather than not at all.
    await logError(error, { source: "autopilot.angles", level: "warn", businessId });
  }
  return out;
}
