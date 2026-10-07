// Shapes shared by the publishing server code and the calendar and composer screens. Client-safe.
import type { Network } from "@/lib/social/types";
import type { PostStatusName } from "./status";
import type { PostFormatName, RuleSummary } from "./validate";

export type CalendarPost = {
  id: string;
  groupId: string | null;
  network: Network;
  connectionId: string | null;
  accountName: string;
  accountAvatar: string | null;
  /** NOTIFY accounts get a reminder email instead of an API post. */
  notify: boolean;
  status: PostStatusName;
  format: PostFormatName | "ARTICLE" | "THREAD";
  source: "MANUAL" | "AUTOPILOT";
  title: string | null;
  text: string;
  hashtags: string[];
  link: string | null;
  mediaPaths: string[];
  /** Signed preview links, same order as mediaPaths (missing files are skipped). */
  media: { path: string; url: string }[];
  scheduledAt: string | null;
  publishedAt: string | null;
  permalink: string | null;
  lastError: string | null;
  projectId: string | null;
  contentId: string | null;
};

export type ComposerAccount = {
  id: string;
  network: Network;
  label: string;
  displayName: string;
  avatarUrl: string | null;
  accountType: string | null;
  notify: boolean;
  /** False when the account must be reconnected first. */
  usable: boolean;
  problem?: string;
};

export type ComposerContext = {
  accounts: ComposerAccount[];
  rules: Partial<Record<Network, RuleSummary>>;
  timezone: string;
  slotTimes: string[];
};

export type MediaItem = { path: string; url: string; mimeType?: string };

export type Overrides = Partial<Record<Network, { text?: string; hashtags?: string[] }>>;

/** What a screen can pre-fill the composer with (generated content, a duplicated post...). */
export type ComposerPrefill = {
  text?: string;
  hashtags?: string[];
  overrides?: Overrides;
  media?: MediaItem[];
  projectId?: string;
  contentId?: string;
  connectionIds?: string[];
};

export type When =
  | { mode: "queue" }
  | { mode: "schedule"; local: string }
  | { mode: "draft" }
  | { mode: "now" };

export type ComposeInput = {
  connectionIds: string[];
  text: string;
  hashtags: string[];
  overrides: Overrides;
  mediaPaths: string[];
  link?: string | null;
  projectId?: string | null;
  contentId?: string | null;
  when: When;
};

export type EditInput = {
  text: string;
  hashtags: string[];
  mediaPaths: string[];
  link?: string | null;
  /** "keep" leaves the status and time as they are. */
  when: When | { mode: "keep" };
};

export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string> };
export type ActionOk<T = object> = { ok: true } & T;
export type ActionResult<T = object> = ActionOk<T> | ActionFailure;

/** After "Post now": how each post ended up, so the screen can say so. */
export type PostOutcome = { id: string; network: Network; status: PostStatusName; error?: string | null };
