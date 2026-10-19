import "server-only";
import { inboxAvailable, privateReply, replyToComment, sendMessage } from "@/lib/social/inbox/outbound";
import { cachedInboxSettings } from "@/lib/social/inbox/settings";
import { registerChannel } from "../channels";
import type { ChannelAdapter } from "../types";

// Instagram DMs and comments as an inbox channel. What arrives comes in through BuPulse-Socials checks
// (lib/social/inbox/poll.ts) or Meta's webhooks (app/api/meta/webhook); sending goes through the route the Admin switch
// picked (lib/social/inbox/outbound.ts). docs/SOCIAL_INBOX.md.

export const instagramChannel: ChannelAdapter = {
  kind: "INSTAGRAM",
  capabilities: {
    buttons: false,
    quickReplies: false,
    images: true,
    commentReply: true,
    // Only once an admin confirmed private replies work (the setting is read when available() runs).
    get privateReply() {
      return cachedInboxSettings().privateReplyConfirmed;
    },
    windowHours: 24,
  },
  available: inboxAvailable,
  send: (target, message) => sendMessage("instagram", target, message),
  replyToComment: (target, commentId, text) => replyToComment("instagram", target, commentId, text),
  privateReply: (target, commentId, message) => privateReply("instagram", target, commentId, message),
};

registerChannel(instagramChannel);
