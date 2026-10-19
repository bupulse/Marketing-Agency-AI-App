import "server-only";
import { isServiceEnabled } from "@/lib/admin/switch";
import { metaSecrets } from "@/app/api/meta/data-deletion/signed-request";
import { getInboxSettings, type InboxTransport } from "./settings";

// Which way an account's comments and DMs travel. One Admin switch (lib/social/inbox/settings.ts) picks the route for
// every account; an account can use it only if it was connected that way:
//   - "composio": accounts connected through BuPulse-Socials (Connection.method COMPOSIO), checked by due jobs;
//   - "meta": accounts connected with BuPulse's own Meta app (method DIRECT), told by Meta's webhooks.
// An account connected the other way shows "Reconnect to answer messages" on the Channels page.

/** BuPulse-Socials is usable: its key is set (saved keys are loaded by the switch) and it is switched on in Admin. */
export async function composioReady(): Promise<boolean> {
  const on = await isServiceEnabled("composio");
  return on && !!process.env.COMPOSIO_API_KEY;
}

/** BuPulse's own Meta app can receive webhooks and send: an app secret and the webhook verify token are set, Meta is on. */
export async function metaReady(): Promise<boolean> {
  const on = await isServiceEnabled("meta");
  return on && metaSecrets().length > 0 && !!process.env.META_WEBHOOK_VERIFY_TOKEN;
}

export async function transportReady(transport: InboxTransport): Promise<boolean> {
  return transport === "composio" ? composioReady() : metaReady();
}

export type ConnectionRoute = { ok: true; transport: InboxTransport } | { ok: false; reason: "other_method" };

/** Whether this connection can use the current route. */
export function routeFor(method: string, transport: InboxTransport): ConnectionRoute {
  if (transport === "composio") return method === "COMPOSIO" ? { ok: true, transport } : { ok: false, reason: "other_method" };
  return method === "DIRECT" ? { ok: true, transport } : { ok: false, reason: "other_method" };
}

export async function currentTransport(): Promise<InboxTransport> {
  return (await getInboxSettings()).transport;
}
