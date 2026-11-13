import type { ReactNode } from "react";
import type { Network } from "@/lib/social/types";

// Data-only props shared by the media cards (components/media-cards/README.md). Nothing here reads the database: the
// pages map their rows to these shapes (adapters.ts has the mappings for the shapes that exist today).

export type Platform = Network;

/** One picture or video of a post. `url` is a signed link the browser can load. */
export type MediaItem = {
  kind: "image" | "video";
  url: string;
  /** A still for a video (shown before it plays). */
  poster?: string | null;
  /** A short muted clip for the hover preview; the video itself when missing. */
  previewUrl?: string | null;
  alt?: string;
  durationMs?: number | null;
};

/** "9:16" (reels, stories, TikTok), "4:5" (feed), "1:1", "16:9" (YouTube, LinkedIn video). */
export type Ratio = "9:16" | "4:5" | "1:1" | "16:9" | "1.91:1";

/**
 * The status pill. Posts: draft, pending (waiting for approval), scheduled, publishing, posted, failed, reminder (post it
 * yourself), expired, cancelled. Videos: ready, new. Campaigns: live, paused, ended, draft.
 */
export type StatusKey =
  | "draft"
  | "pending"
  | "scheduled"
  | "publishing"
  | "posted"
  | "failed"
  | "reminder"
  | "expired"
  | "cancelled"
  | "ready"
  | "new"
  | "live"
  | "paused"
  | "ended";

/** A real action on a card (Edit, Schedule, Approve, Delete...). Shown as a labelled icon button, 44 px tall. */
export type MediaAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: "primary" | "danger" | "default";
  disabled?: boolean;
  /** Shown only in the opened post (PostModal), not on the small card. */
  modalOnly?: boolean;
};

export type Account = {
  name: string;
  avatarUrl?: string | null;
  /** "@leafrwanda" on X and TikTok. */
  handle?: string | null;
};

export type Subject = { kind: "product" | "campaign"; name: string; href?: string | null };

/** One post, as PostCard and PostModal show it. */
export type PostView = {
  id: string;
  platform: Platform;
  account: Account;
  /** Already formatted for the business's time zone: "2h", "Tomorrow 12:30" (helpers.ts timeLabel). */
  timeLabel?: string | null;
  media: MediaItem[];
  caption: string;
  hashtags?: string[];
  status?: StatusKey | null;
  /** Overrides the pill's words ("Scheduled · Fri 12:30"). */
  statusLabel?: string | null;
  subject?: Subject | null;
  /** The article title (LinkedIn articles). */
  title?: string | null;
  link?: string | null;
};

/** PostModal adds the per-platform captions of the same post and the details list. */
export type PostDetailView = PostView & {
  /**
   * The same post on other platforms with their own captions: shown as tabs. `label` is the tab's name when two
   * versions share an app ("Facebook · Carousel"); the app's name otherwise.
   */
  variants?: { platform: Platform; caption: string; hashtags?: string[]; status?: StatusKey | null; label?: string }[];
  details?: { label: string; value: ReactNode }[];
  /** The full date line under the actions ("Scheduled for Friday 14 November, 12:30"). */
  dateLine?: string | null;
};
