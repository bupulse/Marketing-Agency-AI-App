// Types and labels of the activity feed, safe to import in client components.

export const ACTIVITY_GROUPS = ["signup", "onboarded", "post", "lead", "payment", "refund", "plan", "error", "admin"] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

export const ACTIVITY_LABELS: Record<ActivityGroup, string> = {
  signup: "Sign-ups",
  onboarded: "Onboarding done",
  post: "Posts",
  lead: "Leads",
  payment: "Payments",
  refund: "Refunds",
  plan: "Plan changes",
  error: "Errors",
  admin: "Admin and Jarvis",
};

export type ActivityItem = {
  /** "<source>:<row id>", unique and stable. */
  id: string;
  at: string;
  group: ActivityGroup;
  title: string;
  detail: string | null;
  tone: "neutral" | "good" | "bad";
  userId: string | null;
  /** Business name and owner email, which the admin already sees on the Users page. */
  who: string | null;
  href: string | null;
};

export type ActivityPage = {
  items: ActivityItem[];
  /** Pass as `before` to load the next older page; null when there is nothing older. */
  nextBefore: string | null;
  /** Pass as `after` to poll for newer items. Always set, even for an empty feed, so polling never stops. */
  newest: string | null;
  /** Polling only: more new items are waiting beyond this batch, so ask again straight away. */
  more: boolean;
};


export const POLL_MS = 5000;
export const QUIET_AFTER_MS = 2 * 60_000;
export const QUIET_POLL_MS = 15_000;

/** Time to the next poll: 5 seconds, or 15 once nothing new has arrived for 2 minutes. */
export const pollDelay = (lastNewAt: number, now: number) => (now - lastNewAt > QUIET_AFTER_MS ? QUIET_POLL_MS : POLL_MS);
