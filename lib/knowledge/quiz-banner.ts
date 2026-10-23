// The Business info quiz banner on every dashboard page (docs/QUIZ_MODE.md "On every page"). Pure, so it is tested.

/** Where the banner is not shown: Home and Business info have the big quiz card, and the quiz itself needs no reminder. */
export function quizBannerHere(pathname: string | null): boolean {
  const path = (pathname ?? "").replace(/\/+$/, "") || "/";
  if (path === "/dashboard" || path === "/dashboard/knowledge") return false;
  return !path.startsWith("/dashboard/knowledge/quiz");
}

/** The viewer's local day as YYYY-MM-DD: "Not now" hides the banner until this changes. */
export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The banner's line under the title: how far along, and the round that opens. */
export function quizBannerText(overall: number, nextRound: { emoji: string; title: string } | null): string {
  const known = overall === 0 ? "BuPulse doesn't know your business yet." : `BuPulse knows your business ${overall}%.`;
  return nextRound ? `${known} Next: ${nextRound.emoji} ${nextRound.title}.` : known;
}
