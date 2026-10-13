// Client health rules (Admin -> Clients -> Client health). Pure, so they are unit-tested on their own.

export type HealthFlag = "past_due" | "trial_ending" | "inactive" | "low_usage" | "waiting_demo" | "suspended";
export const FLAG_LABEL: Record<HealthFlag, string> = {
  past_due: "Past due",
  trial_ending: "Trial ends soon",
  inactive: "Inactive 7 days",
  low_usage: "Low usage",
  waiting_demo: "Waiting for demo",
  suspended: "Suspended",
};
const WEIGHT: Record<HealthFlag, number> = { past_due: 3, suspended: 3, trial_ending: 2, inactive: 2, low_usage: 1, waiting_demo: 1 };

export type HealthInput = {
  status: string | null;
  plan: string | null;
  trialEndsAt: Date | null;
  lastActiveAt: Date | null;
  /** Highest share of a monthly limit used this period (0 to 1), or null without limits. */
  usageShare: number | null;
  /** Days since the billing period started. */
  periodDays: number;
  suspended: boolean;
};

const DAY = 86_400_000;
export const INACTIVE_DAYS = 7;
export const TRIAL_WARN_DAYS = 3;
/** Under this share of every limit, after a week of the period, a paying client is "low usage". */
export const LOW_USAGE_SHARE = 0.1;

export function healthFlags(c: HealthInput, now: Date): HealthFlag[] {
  const flags: HealthFlag[] = [];
  if (c.suspended) flags.push("suspended");
  if (c.status === "PAST_DUE") flags.push("past_due");
  if (c.status === "PENDING_DEMO") flags.push("waiting_demo");
  if (c.status === "TRIALING" && c.trialEndsAt && c.trialEndsAt.getTime() - now.getTime() <= TRIAL_WARN_DAYS * DAY && c.trialEndsAt.getTime() > now.getTime() - DAY) flags.push("trial_ending");
  const live = c.status === "ACTIVE" || c.status === "TRIALING" || c.status === "PAST_DUE";
  if (live && (!c.lastActiveAt || now.getTime() - c.lastActiveAt.getTime() > INACTIVE_DAYS * DAY)) flags.push("inactive");
  if (c.status === "ACTIVE" && c.plan !== "TRIAL" && c.periodDays >= 7 && c.usageShare !== null && c.usageShare < LOW_USAGE_SHARE) flags.push("low_usage");
  return flags;
}

/** 0 is healthy; the higher, the sooner the client needs a call. */
export const riskScore = (flags: HealthFlag[]) => flags.reduce((s, f) => s + WEIGHT[f], 0);
export const riskLevel = (score: number): "high" | "medium" | "ok" => (score >= 3 ? "high" : score >= 1 ? "medium" : "ok");

/** A wa.me link for a phone number (digits only, with country code), with a short opening line. Null without a usable number. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? "").replace(/[^\d]/g, "").replace(/^00/, "");
  if (digits.length < 9 || digits.length > 15) return null;
  // A Rwandan number typed without the country code (07...) gets +250.
  const full = digits.startsWith("0") && digits.length === 10 ? `250${digits.slice(1)}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(email: string | null | undefined, subject: string): string | null {
  return email ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : null;
}

/** The share of the busiest limit used: max over metrics with a positive limit. */
export function usageShareOf(used: Record<string, number>, limits: Record<string, number>): number | null {
  let best: number | null = null;
  for (const [k, limit] of Object.entries(limits)) {
    if (!(limit > 0) || !(k in used)) continue;
    const share = used[k] / limit;
    best = best === null ? share : Math.max(best, share);
  }
  return best;
}
