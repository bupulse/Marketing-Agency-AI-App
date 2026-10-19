// Labels shared by the inbox's server code and its pages (no server imports).

export const CHANNEL_KINDS = ["WEBSITE", "INSTAGRAM", "FACEBOOK", "WHATSAPP", "TELEGRAM", "TIKTOK", "EMAIL", "SMS"] as const;
export type ChannelKindValue = (typeof CHANNEL_KINDS)[number];

export const CHANNEL_LABELS: Record<ChannelKindValue, string> = {
  WEBSITE: "Website chat",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  WHATSAPP: "WhatsApp",
  TELEGRAM: "Telegram",
  TIKTOK: "TikTok",
  EMAIL: "Email",
  SMS: "SMS",
};

export const INBOX_VIEWS = ["open", "mine", "unassigned", "closed", "all"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];
export const VIEW_LABELS: Record<InboxView, string> = { open: "Open", mine: "Mine", unassigned: "Unassigned", closed: "Closed", all: "All" };

export function isChannelKind(value: unknown): value is ChannelKindValue {
  return typeof value === "string" && (CHANNEL_KINDS as readonly string[]).includes(value);
}
