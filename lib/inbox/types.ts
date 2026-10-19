// The contract between channels (website chat, Instagram, Facebook, WhatsApp, ...) and the conversations engine
// (contacts, inbox, automations). docs/INBOX.md explains it in plain words.
//
// A channel does two things:
//   1. When something arrives (a DM, a comment, a Story mention), it builds an InboundEvent and calls
//      ingestInbound() (lib/inbox/ingest.ts). It never writes contacts, conversations or messages itself.
//   2. It registers a ChannelAdapter (lib/inbox/channels.ts) that sends what the engine asks it to send.
// Everything else (contacts, the inbox, automations, AI replies, leads, alerts) is the engine's job and works the same
// for every channel.

import type { ChannelKind, MessageKind } from "@/lib/generated/prisma/client";

export type { ChannelKind, MessageKind };

/** Who the person is on the channel. `externalId` is stable per business and channel (Instagram-scoped id, PSID, visitor id, phone). */
export type ChannelContact = {
  externalId: string;
  name?: string;
  handle?: string; // @username
  avatarUrl?: string;
  email?: string;
  phone?: string;
  language?: string;
};

/** Something that arrived on a channel, already checked (signature, ownership) by the channel. */
export type InboundEvent = {
  businessId: string;
  channel: ChannelKind;
  /** The connected account it arrived on (Connection.id); null for the website. */
  connectionId?: string | null;
  kind: Extract<MessageKind, "MESSAGE" | "COMMENT" | "STORY_MENTION">;
  contact: ChannelContact;
  /** The platform's thread id (DM conversation id). For comments, leave empty: the engine keeps one comments thread per person and account. */
  threadExternalId?: string;
  /** The website chat session, for the website channel only. */
  chatSessionId?: string;
  text: string;
  /** The id of the message or comment on the platform: the same id twice is stored once (polling may see it again). */
  externalMessageId?: string;
  /** For comments: the post (media) it is under, and the post's caption or link, so automations can match a post. */
  postExternalId?: string;
  postCaption?: string;
  /** A button the person tapped (its id), when the platform reports postbacks. */
  buttonId?: string;
  occurredAt?: Date;
};

export type OutboundButton = { id: string; title: string; url?: string };

/** What the engine asks a channel to send. Channels drop what they cannot show (see ChannelCapabilities). */
export type OutboundMessage = {
  text: string;
  buttons?: OutboundButton[];
  quickReplies?: string[];
  imageUrl?: string;
};

/** Where to send: the conversation and the person, as the channel knows them. */
export type SendTarget = {
  businessId: string;
  conversationId: string;
  channel: ChannelKind;
  connectionId: string | null;
  threadExternalId: string | null;
  chatSessionId: string | null;
  /** The person's id on the channel (ContactIdentity.externalId). */
  recipientExternalId: string | null;
};

export type SendResult = { externalId?: string };

export type ChannelCapabilities = {
  buttons: boolean;
  quickReplies: boolean;
  images: boolean;
  /** Public reply under a comment. */
  commentReply: boolean;
  /** First DM to someone who only commented (Meta "private reply": once per comment, within 7 days). */
  privateReply: boolean;
  /** Messages are only allowed within this many hours of the person's last message (24 on Meta), or null. */
  windowHours: number | null;
};

/** Thrown by an adapter when sending is not possible; `retry` says whether trying again later could work. */
export class ChannelSendError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ChannelSendError";
  }
}

export interface ChannelAdapter {
  kind: ChannelKind;
  capabilities: ChannelCapabilities;
  /** Is the channel usable right now (keys set, service switched on in Admin)? Off channels are skipped quietly. */
  available(): Promise<boolean>;
  /** Sends a message in the conversation. */
  send(target: SendTarget, message: OutboundMessage): Promise<SendResult>;
  /** Public reply under a comment (commentReply). */
  replyToComment?(target: SendTarget, commentExternalId: string, text: string): Promise<SendResult>;
  /** Private DM to a commenter (privateReply). */
  privateReply?(target: SendTarget, commentExternalId: string, message: OutboundMessage): Promise<SendResult>;
}
