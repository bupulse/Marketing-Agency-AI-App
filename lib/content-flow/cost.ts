// What a "Create today's content" run uses, shown before the owner confirms (docs/CONTENT.md). Pure, so the dialog
// and the server agree. Text: one generation per post (the current metering). AI images: at most one per designed
// post, only with "AI designs" and while the plan's image credits last. Videos BuPulse makes count video seconds
// when they are made, as before.

export type DayMode = "ai" | "describe" | "own";
export type DesignChoice = "ai" | "free";

export type RunCostInput = {
  mode: DayMode;
  design: DesignChoice;
  /** Posts in the run (one per network). */
  posts: number;
  /** Posts that get a designed picture (not the owner's own media, not a video only). */
  designed: number;
  /** AI photos are possible at all: the plan has them, credits and the AI allowance are left. */
  aiPhotos: boolean;
  textLeft: number;
  imagesLeft: number;
};

export type RunCost = { text: number; aiImages: number; enoughText: boolean; message: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function runCost(input: RunCostInput): RunCost {
  const text = Math.max(0, input.posts);
  const aiImages = input.mode !== "own" && input.design === "ai" && input.aiPhotos ? Math.max(0, Math.min(input.designed, input.imagesLeft)) : 0;
  const textLeft = Math.max(0, input.textLeft);
  const enoughText = text > 0 && textLeft >= text;
  const uses = aiImages > 0 ? `Uses ${plural(text, "text generation", "text generations")} and up to ${plural(aiImages, "AI image", "AI images")}` : `Uses ${plural(text, "text generation", "text generations")} and no AI images`;
  const left = input.mode !== "own" && input.design === "ai" ? `you have ${plural(textLeft, "text generation", "text generations")} and ${plural(Math.max(0, input.imagesLeft), "AI image", "AI images")} left this month` : `you have ${plural(textLeft, "text generation", "text generations")} left this month`;
  const short = enoughText ? "" : text === 0 ? " Choose at least one app." : ` Choose ${textLeft === 0 ? "again when your credits renew" : `at most ${textLeft} ${textLeft === 1 ? "app" : "apps"}`}.`;
  return { text, aiImages, enoughText, message: `${uses}; ${left}.${short}` };
}
