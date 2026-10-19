import "server-only";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { ChannelSendError, type OutboundMessage, type SendResult, type SendTarget } from "@/lib/inbox/types";
import { proxyRequest, runTool } from "../composio/client";
import { graphPost, GRAPH_VERSION } from "../graph";
import { loadCredentials } from "../connections";
import { SocialError } from "../types";
import { reserveComposioCalls } from "./budget";
import { asObject, str } from "./mapping";
import { getInboxSettings, type InboxTransport } from "./settings";
import { routeFor, transportReady } from "./transport";

// Sending on Instagram and Facebook for the inbox adapters (lib/inbox/channels/instagram.ts, facebook.ts), through
// whichever route the Admin switch picked: BuPulse-Socials (Composio tools, budgeted) or Meta direct (Graph API with the
// account's own token). Every failure becomes a ChannelSendError with a plain-English message the inbox shows.

export type SocialNetwork = "instagram" | "facebook";

/** Instagram DMs take 1,000 characters, Facebook 2,000; Instagram comment replies 300 (Composio's tool notes). */
const LIMITS = { instagram: { dm: 1000, reply: 300 }, facebook: { dm: 2000, reply: 8000 } } as const;

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** Link buttons become lines of text: neither route sends real buttons yet. Quick replies are dropped. */
export function textOf(message: OutboundMessage): string {
  const links = (message.buttons ?? []).filter((b) => b.url).map((b) => `${b.title}: ${b.url}`);
  return [message.text.trim(), ...links].filter(Boolean).join("\n\n");
}

const WINDOW = /outside (of )?(the )?(allowed )?(messaging )?window|2534022|2018278|24.hour|re-?engagement/i;
const PRIVATE_DONE = /already.*(replied|sent)|only one (private )?reply|2018108|10903/i;

/** Maps a network or Composio failure to what the inbox shows. */
export function sendError(network: SocialNetwork, error: unknown): ChannelSendError {
  if (error instanceof ChannelSendError) return error;
  const label = network === "instagram" ? "Instagram" : "Facebook";
  const message = error instanceof Error ? error.message : String(error);
  if (WINDOW.test(message)) return new ChannelSendError(`${label} only allows replies within 24 hours of the person's last message.`, false, "window");
  if (PRIVATE_DONE.test(message)) return new ChannelSendError(`${label} allows one private reply per comment, and this comment already has one.`, false, "private_reply_used");
  if (error instanceof SocialError) {
    if (error.kind === "auth") return new ChannelSendError(`This ${label} account needs to be reconnected on the Channels page.`, false, "auth");
    if (error.kind === "rate_limit") return new ChannelSendError(`${label} is busy. BuPulse will try again shortly.`, true, "rate_limit");
    if (error.kind === "invalid") return new ChannelSendError(`${label} refused this message: ${message.slice(0, 160)}`, false, "invalid");
  }
  return new ChannelSendError(`${label} could not be reached. Please try again.`, true, "temporary");
}

type Account = { id: string; businessId: string; provider: string; method: string; externalAccountId: string; accessTokenEncrypted: string | null; inboxEnabled: boolean };

async function accountFor(network: SocialNetwork, target: SendTarget): Promise<Account> {
  const label = network === "instagram" ? "Instagram" : "Facebook";
  const row = target.connectionId
    ? await prisma.connection.findUnique({ where: { id: target.connectionId }, select: { id: true, businessId: true, provider: true, method: true, externalAccountId: true, accessTokenEncrypted: true, inboxEnabled: true } })
    : null;
  if (!row || row.businessId !== target.businessId || row.provider !== network) throw new ChannelSendError(`This ${label} account is no longer connected.`, false, "no_account");
  if (!row.inboxEnabled) throw new ChannelSendError(`Answering comments and messages is switched off for this ${label} account (Channels page).`, false, "inbox_off");
  return row;
}

type Route = { transport: InboxTransport; account: Account };

async function route(network: SocialNetwork, target: SendTarget): Promise<Route> {
  const account = await accountFor(network, target);
  const { transport } = await getInboxSettings();
  if (!routeFor(account.method, transport).ok) {
    throw new ChannelSendError("This account was connected another way. Reconnect it on the Channels page to answer messages.", false, "other_method");
  }
  if (!(await transportReady(transport))) throw new ChannelSendError("This channel is not switched on yet.", true, "not_ready");
  return { transport, account };
}

/** Reserves one Composio call against the monthly limit (replies may use the reserve the checks leave). */
async function budgeted<T>(fn: () => Promise<T>): Promise<T> {
  const { monthlyCap } = await getInboxSettings();
  if (!(await reserveComposioCalls(1, monthlyCap))) {
    throw new ChannelSendError("BuPulse has used this month's replies through BuPulse-Socials. Answer in the Instagram or Facebook app until the 1st.", false, "budget");
  }
  return fn();
}

const idOf = (data: unknown) => str(asObject(data).message_id) ?? str(asObject(data).id) ?? str(asObject(asObject(data).data).message_id) ?? str(asObject(asObject(data).data).id);

async function composio(network: SocialNetwork, account: Account, slug: string, args: Record<string, unknown>): Promise<SendResult> {
  const connectedAccountId = await decrypt(account.accessTokenEncrypted!);
  const data = await budgeted(() => runTool(network, slug, connectedAccountId, account.businessId, args, { reserved: true }));
  return { externalId: idOf(data) };
}

/** The Graph host for a direct connection's token: Instagram Login tokens start with "IG". */
const hostFor = (token: string) => (token.startsWith("IG") ? `https://graph.instagram.com/${GRAPH_VERSION}` : `https://graph.facebook.com/${GRAPH_VERSION}`);

async function meta(network: SocialNetwork, account: Account, path: (base: string) => string, params: Record<string, string | undefined>): Promise<SendResult> {
  const { accessToken } = await loadCredentials(account.id);
  const base = network === "facebook" ? `https://graph.facebook.com/${GRAPH_VERSION}` : hostFor(accessToken);
  const data = await graphPost(network, path(base), { ...params, access_token: accessToken });
  return { externalId: idOf(data) };
}

// Messages go to the account itself ("me" is the Instagram account, or the Page for a Page token).
const json = (v: unknown) => JSON.stringify(v);

export async function sendMessage(network: SocialNetwork, target: SendTarget, message: OutboundMessage): Promise<SendResult> {
  if (target.threadExternalId?.startsWith("comments:")) {
    // Someone who only commented has no DM thread: Meta allows one private reply per comment instead.
    throw new ChannelSendError("This person only commented. Reply under the comment, or send a private reply to the comment.", false, "comment_thread");
  }
  if (!target.recipientExternalId) throw new ChannelSendError("BuPulse does not know this person's account id.", false, "no_recipient");
  const recipient = target.recipientExternalId;
  const text = clip(textOf(message), LIMITS[network].dm);
  try {
    const { transport, account } = await route(network, target);
    const page = account.externalAccountId;
    let result: SendResult = {};
    if (transport === "composio") {
      if (message.imageUrl) {
        result = network === "instagram"
          ? await composio(network, account, "INSTAGRAM_SEND_IMAGE", { recipient_id: recipient, image_url: message.imageUrl, ig_user_id: page })
          : await composio(network, account, "FACEBOOK_SEND_MEDIA_MESSAGE", { page_id: page, recipient_id: recipient, media_url: message.imageUrl, media_type: "image", messaging_type: "RESPONSE" });
      }
      if (text) {
        result = network === "instagram"
          ? await composio(network, account, "INSTAGRAM_SEND_TEXT_MESSAGE", { recipient_id: recipient, text, ig_user_id: page })
          : await composio(network, account, "FACEBOOK_SEND_MESSAGE", { page_id: page, recipient_id: recipient, message_text: text, messaging_type: "RESPONSE" });
      }
      return result;
    }
    const path = (base: string) => (network === "facebook" ? `${base}/${page}/messages` : `${base}/me/messages`);
    const extra = network === "facebook" ? { messaging_type: "RESPONSE" } : {};
    if (message.imageUrl) result = await meta(network, account, path, { recipient: json({ id: recipient }), message: json({ attachment: { type: "image", payload: { url: message.imageUrl } } }), ...extra });
    if (text) result = await meta(network, account, path, { recipient: json({ id: recipient }), message: json({ text }), ...extra });
    return result;
  } catch (error) {
    throw sendError(network, error);
  }
}

export async function replyToComment(network: SocialNetwork, target: SendTarget, commentId: string, rawText: string): Promise<SendResult> {
  const text = clip(rawText.trim(), LIMITS[network].reply);
  try {
    const { transport, account } = await route(network, target);
    if (transport === "composio") {
      return network === "instagram"
        ? await composio(network, account, "INSTAGRAM_POST_IG_COMMENT_REPLIES", { ig_comment_id: commentId, message: text })
        : await composio(network, account, "FACEBOOK_CREATE_COMMENT", { object_id: commentId, message: text });
    }
    return await meta(network, account, (base) => (network === "instagram" ? `${base}/${commentId}/replies` : `${base}/${commentId}/comments`), { message: text });
  } catch (error) {
    throw sendError(network, error);
  }
}

/**
 * Meta's "private reply": the first DM to someone who commented, once per comment, within 7 days. Composio has no tool
 * for it, so that route uses Composio's proxy (best effort). Refused unless an admin confirmed it works (settings.ts).
 */
export async function privateReply(network: SocialNetwork, target: SendTarget, commentId: string, message: OutboundMessage): Promise<SendResult> {
  const text = clip(textOf(message), LIMITS[network].dm);
  try {
    const settings = await getInboxSettings();
    if (!settings.privateReplyConfirmed) throw new ChannelSendError("Private replies are not switched on yet. Reply under the comment instead.", false, "private_reply_off");
    const { transport, account } = await route(network, target);
    const page = account.externalAccountId;
    const body = { recipient: { comment_id: commentId }, message: { text } };
    if (transport === "composio") {
      const connectedAccountId = await decrypt(account.accessTokenEncrypted!);
      const data = await budgeted(() =>
        proxyRequest(network, connectedAccountId, account.businessId, { endpoint: `/${page}/messages`, method: "POST", body }, { reserved: true }),
      );
      return { externalId: idOf(data) };
    }
    return await meta(network, account, (base) => (network === "facebook" ? `${base}/${page}/messages` : `${base}/me/messages`), { recipient: json(body.recipient), message: json(body.message) });
  } catch (error) {
    throw sendError(network, error);
  }
}

/** For the adapters' available(): the current route is set up and switched on. */
export async function inboxAvailable(): Promise<boolean> {
  const { transport } = await getInboxSettings();
  return transportReady(transport);
}
