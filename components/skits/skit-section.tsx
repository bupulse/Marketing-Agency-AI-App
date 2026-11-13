import { todayIn } from "@/lib/content-flow/day";
import { companySkitsPerWeek, loadSkitCards } from "@/lib/skits/service";
import { nextSkitDay, skitDaysText } from "@/lib/skits/schedule";
import { SkitBoard } from "./skit-board";
import { EXTRA_SKIT_PRICE_RWF } from "@/lib/skits/shared";
import { clientPrice, vatApplies } from "@/lib/billing/vat";
import { getVatSettings } from "@/lib/billing/vat-server";

/** The Posts page's "Talking skits" (lib/skits): nothing for a plan without skits that has none open. */
export async function SkitSection({ businessId, zone, canRecord }: { businessId: string; zone: string; canRecord: boolean }) {
  const now = new Date();
  const [perWeek, cards, vat] = await Promise.all([companySkitsPerWeek(businessId).catch(() => 0), loadSkitCards(businessId).catch(() => []), getVatSettings()]);
  if (perWeek === 0 && cards.length === 0) return null;
  const today = todayIn(zone, now);
  // An extra skit is priced before VAT (5,000 RWF); the client sees it with VAT (lib/billing/vat.ts).
  const extraPrice = { minor: clientPrice(EXTRA_SKIT_PRICE_RWF, "RWF", vat), vatIncluded: vatApplies("RWF", vat) };
  return <SkitBoard cards={cards} plan={{ perWeek, daysText: skitDaysText(perWeek), nextDay: nextSkitDay(perWeek, today), today, canRecord, extraPrice }} />;
}
