import { todayIn } from "@/lib/content-flow/day";
import { companySkitsPerWeek, loadSkitCards } from "@/lib/skits/service";
import { nextSkitDay, skitDaysText } from "@/lib/skits/schedule";
import { SkitBoard } from "./skit-board";

/** The Posts page's "Talking skits" (lib/skits): nothing for a plan without skits that has none open. */
export async function SkitSection({ businessId, zone, canRecord }: { businessId: string; zone: string; canRecord: boolean }) {
  const now = new Date();
  const [perWeek, cards] = await Promise.all([companySkitsPerWeek(businessId).catch(() => 0), loadSkitCards(businessId).catch(() => [])]);
  if (perWeek === 0 && cards.length === 0) return null;
  const today = todayIn(zone, now);
  return <SkitBoard cards={cards} plan={{ perWeek, daysText: skitDaysText(perWeek), nextDay: nextSkitDay(perWeek, today), today, canRecord }} />;
}
