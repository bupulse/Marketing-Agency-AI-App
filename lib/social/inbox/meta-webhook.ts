import type { InboundEvent } from "@/lib/inbox/types";
import { asObject, listIn, str, timeOf } from "./mapping";

// Meta's webhooks for the direct route (app/api/meta/webhook): checking the signature and reading the payload into
// InboundEvents. Pure, no database. Payload shapes (Graph API v23):
//   Instagram (object "instagram"): entry[].id = the Instagram account; changes[] field "comments" (value: id, text,
//     from {id, username}, media {id}, parent_id); messaging[] (sender, recipient, timestamp, message {mid, text,
//     is_echo, attachments [{type: "story_mention"}], quick_reply {payload}}, postback {mid, title, payload}).
//   Facebook Page (object "page"): entry[].id = the Page; changes[] field "feed" with value.item "comment" and verb "add"
//     (comment_id, post_id, message, from {id, name}, created_time, parent_id); messaging[] as above (sender = PSID).
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started

const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Checks X-Hub-Signature-256 ("sha256=<hex>", HMAC-SHA256 of the raw body) against each app secret, in constant time. */
export async function verifySignature(rawBody: string, header: string | null, secrets: string[]): Promise<boolean> {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? "");
  const signature = match ? hexToBytes(match[1]) : null;
  if (!signature) return false;
  const data = new TextEncoder().encode(rawBody);
  for (const secret of secrets) {
    if (!secret) continue;
    const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (await globalThis.crypto.subtle.verify("HMAC", key, signature, data)) return true;
  }
  return false;
}

/** Compares two strings without leaking where they differ (the verify token). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export type WebhookItem = {
  network: "instagram" | "facebook";
  /** The business's account the event is for (Instagram account id or Page id). */
  accountId: string;
  event: Omit<InboundEvent, "businessId" | "connectionId">;
};

function messagingItem(network: WebhookItem["network"], accountId: string, raw: Record<string, unknown>): WebhookItem | null {
  const channel = network === "instagram" ? "INSTAGRAM" : "FACEBOOK";
  const sender = str(asObject(raw.sender).id);
  if (!sender || sender === accountId) return null;
  const at = timeOf(raw.timestamp) ?? undefined;
  const message = asObject(raw.message);
  const postback = asObject(raw.postback);
  if (raw.postback) {
    const title = str(postback.title) ?? "";
    return {
      network,
      accountId,
      event: { channel, kind: "MESSAGE", contact: { externalId: sender }, text: title, buttonId: str(postback.payload), externalMessageId: str(postback.mid) ?? `postback:${sender}:${raw.timestamp ?? ""}`, occurredAt: at },
    };
  }
  if (!raw.message || message.is_echo || message.is_deleted || message.is_unsupported) return null;
  const mid = str(message.mid);
  if (!mid) return null;
  const attachments = listIn(message.attachments);
  const storyMention = attachments.some((a) => str(a.type) === "story_mention");
  const text = str(message.text) ?? (storyMention ? "Mentioned you in their story" : attachments.length ? "Sent an attachment" : "");
  return {
    network,
    accountId,
    event: {
      channel,
      kind: storyMention ? "STORY_MENTION" : "MESSAGE",
      contact: { externalId: sender },
      text,
      externalMessageId: mid,
      buttonId: str(asObject(message.quick_reply).payload),
      occurredAt: at,
    },
  };
}

function changeItem(network: WebhookItem["network"], accountId: string, raw: Record<string, unknown>): WebhookItem | null {
  const field = str(raw.field);
  const value = asObject(raw.value);
  const from = asObject(value.from);
  const fromId = str(from.id);
  if (!fromId || fromId === accountId) return null; // the business's own comment
  if (network === "instagram" && field === "comments") {
    const id = str(value.id);
    if (!id) return null;
    return {
      network,
      accountId,
      event: { channel: "INSTAGRAM", kind: "COMMENT", contact: { externalId: fromId, handle: str(from.username) }, text: str(value.text) ?? "", externalMessageId: id, postExternalId: str(asObject(value.media).id) },
    };
  }
  if (network === "facebook" && field === "feed" && value.item === "comment" && value.verb === "add") {
    const id = str(value.comment_id);
    if (!id) return null;
    return {
      network,
      accountId,
      event: {
        channel: "FACEBOOK",
        kind: "COMMENT",
        contact: { externalId: fromId, name: str(from.name) },
        text: str(value.message) ?? "",
        externalMessageId: id,
        postExternalId: str(value.post_id),
        occurredAt: timeOf(value.created_time) ?? undefined,
      },
    };
  }
  return null;
}

/** Everything in one webhook delivery that the inbox takes in. Unknown objects and fields are ignored. */
export function readWebhook(payload: unknown): WebhookItem[] {
  const body = asObject(payload);
  const network = body.object === "instagram" ? "instagram" : body.object === "page" ? "facebook" : null;
  if (!network) return [];
  const items: WebhookItem[] = [];
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    const e = asObject(entry);
    const accountId = str(e.id);
    if (!accountId) continue;
    for (const m of Array.isArray(e.messaging) ? e.messaging : []) {
      const item = messagingItem(network, accountId, asObject(m));
      if (item) items.push(item);
    }
    for (const c of Array.isArray(e.changes) ? e.changes : []) {
      const item = changeItem(network, accountId, asObject(c));
      if (item) items.push(item);
    }
  }
  return items;
}
