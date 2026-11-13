// What each partner fault means for the owner, as one Admin -> Health item (lib/admin/service-faults.ts records them).
// Pure: tests/admin/service-faults.test.ts.

export type FaultKey = "composio:key" | "uploadpost:key" | "uploadpost:profile-limit" | "uploadpost:plan-limit";

export type ServiceFault = {
  key: FaultKey;
  since: string;
  lastAt: string;
  /** How many calls hit it (counted in batches, so roughly). */
  count: number;
  /** The partner's own words, cut short (never a key). */
  detail: string;
  /** For a refused key: a short one-way hash of that key, so a new key is not blamed. */
  keyHash: string | null;
  /** For a limit that resets: when it is expected to pass. */
  until: string | null;
};

type HealthIssue = { level: "warning" | "problem"; key: string; text: string; href: string };

export const FAULT_SERVICE: Record<FaultKey, { service: string; name: string; clearedByTest: boolean }> = {
  "composio:key": { service: "composio", name: "Composio (BuPulse-Socials)", clearedByTest: true },
  "uploadpost:key": { service: "uploadpost", name: "Upload-Post", clearedByTest: true },
  "uploadpost:profile-limit": { service: "uploadpost", name: "Upload-Post", clearedByTest: false },
  "uploadpost:plan-limit": { service: "uploadpost", name: "Upload-Post", clearedByTest: false },
};

/** A profile limit nobody hit again for this long is old news. */
export const PROFILE_LIMIT_SHOWN_MS = 7 * 86_400_000;

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export function faultIssues(faults: ServiceFault[], now: Date): HealthIssue[] {
  const out: HealthIssue[] = [];
  for (const f of faults) {
    if (f.until && Date.parse(f.until) < now.getTime()) continue;
    const times = f.count > 1 ? ` (${f.count} calls stopped since ${day(f.since)})` : ` (since ${day(f.since)})`;
    switch (f.key) {
      case "composio:key":
        out.push({
          level: "problem",
          key: "fault:composio:key",
          text: `Composio refused BuPulse's API key${times}. Posting, inbox and metrics through BuPulse-Socials are paused and nothing is retried with that key. Paste a new key on the Composio card in Services, then press Test now.`,
          href: "/admin/services/composio",
        });
        break;
      case "uploadpost:key":
        out.push({
          level: "problem",
          key: "fault:uploadpost:key",
          text: `Upload-Post refused BuPulse's API key${times}. LinkedIn and TikTok posting through Upload-Post is paused. Paste a new key on the Upload-Post card in Services, then press Test now.`,
          href: "/admin/services/uploadpost",
        });
        break;
      case "uploadpost:profile-limit":
        if (now.getTime() - Date.parse(f.lastAt) > PROFILE_LIMIT_SHOWN_MS) break;
        out.push({
          level: "warning",
          key: "fault:uploadpost:profile-limit",
          text: `Upload-Post's profile limit is reached: a company could not connect LinkedIn or TikTok, last on ${day(f.lastAt)}${f.count > 1 ? ` (${f.count} tries)` : ""}. Companies see "paused on our side". Delete unused profiles in Upload-Post or move to a bigger plan; Connect works again at once.`,
          href: "/admin/services/uploadpost",
        });
        break;
      case "uploadpost:plan-limit":
        out.push({
          level: "warning",
          key: "fault:uploadpost:plan-limit",
          text: `Upload-Post's posting limit for BuPulse's plan is reached${times}. LinkedIn and TikTok posts wait and are tried again${f.until ? ` after ${day(f.until)}` : " later"}; nothing is lost. ${f.detail ? `Upload-Post said: ${f.detail}` : ""}`.trim(),
          href: "/admin/services/uploadpost",
        });
        break;
    }
  }
  return out;
}
