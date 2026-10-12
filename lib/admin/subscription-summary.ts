// One line about where a company's subscription stands, for the admin's Demos list and the company page's demo panel:
// "On trial until 15 Oct", "Active – Business, MoMo, paid until 12 Nov". Pure, so the pages and the tests share it.

export type SubscriptionFacts = {
  status: string;
  plan: string;
  provider: string | null;
  interval: string;
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
  cancelAtPeriodEnd: boolean;
};

/** "15 Oct" in Kigali, where the owner works. */
export function shortDay(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Kigali" });
}

const METHOD: Record<string, string> = { MANUAL_MOMO: "MoMo", PADDLE: "card" };

export type SubscriptionSummary = {
  text: string;
  /** What the admin can do next on the company page (Client 360 actions). */
  links: ("extend_trial" | "change_plan")[];
};

/** Null while the company waits for its demo: that is when Activate account is offered instead. */
export function subscriptionSummary(s: SubscriptionFacts, planName: (key: string) => string, now: Date = new Date()): SubscriptionSummary | null {
  const method = s.provider ? METHOD[s.provider] : null;
  const plan = planName(s.plan);
  const end = s.currentPeriodEnd ? new Date(s.currentPeriodEnd) : null;
  switch (s.status) {
    case "PENDING_DEMO":
      return null;
    case "TRIALING": {
      const t = s.trialEndsAt ? new Date(s.trialEndsAt) : null;
      if (s.plan !== "TRIAL") return { text: `Active – ${plan}${method ? `, ${method}` : ""}${t ? `, card trial until ${shortDay(t)}` : ""}`, links: ["change_plan"] };
      return { text: t ? (t > now ? `On trial until ${shortDay(t)}` : `Trial ended ${shortDay(t)}`) : "On trial", links: ["extend_trial", "change_plan"] };
    }
    case "ACTIVE": {
      const until = end ? (s.cancelAtPeriodEnd ? `, cancels ${shortDay(end)}` : s.provider === "PADDLE" ? `, renews ${shortDay(end)}` : `, paid until ${shortDay(end)}`) : "";
      return { text: `Active – ${plan}${method ? `, ${method}` : ""}${until}`, links: ["change_plan"] };
    }
    case "PAST_DUE":
      return { text: `Past due – ${plan}${method ? `, ${method}` : ""}${end ? ` (ended ${shortDay(end)})` : ""}`, links: ["change_plan"] };
    case "EXPIRED":
      return s.plan === "TRIAL"
        ? { text: `Trial ended${s.trialEndsAt ? ` ${shortDay(s.trialEndsAt)}` : ""}`, links: ["extend_trial", "change_plan"] }
        : { text: `Expired – ${plan}`, links: ["change_plan"] };
    case "CANCELED":
      return { text: `Cancelled – ${plan}${end ? `, ended ${shortDay(end)}` : ""}`, links: ["change_plan"] };
    default:
      return { text: s.status.toLowerCase().replace(/_/g, " "), links: ["change_plan"] };
  }
}
