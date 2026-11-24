// BuPulse Mail: the Cloudflare Email Worker (docs/MAIL_CRM.md "Receiving"). Cloudflare Email Routing hands every
// message for an @bupulse.com address to this Worker (one call per recipient). It posts the raw message to
// https://bupulse.com/api/mail/inbound, signed with MAIL_INBOUND_SECRET, then forwards to the confirmed outside
// addresses the app names (Cloudflare forwarding is free and never uses the 100 daily Resend sends).
//
// If the app does not answer (the office PC is restarting), the message is rejected with a temporary error, so the
// sending server tries again later: nothing is lost. Deploy only with the owner's OK (docs/mail-crm/SETUP.md).

import { signInbound } from "../../lib/mail/signature";

type Env = {
  MAIL_INBOUND_URL: string;
  MAIL_INBOUND_SECRET: string;
  /** Optional safety net while B Mail starts: every message is also forwarded here (a confirmed Cloudflare destination). */
  SAFETY_COPY_TO?: string;
};

type ForwardableEmailMessage = {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
};

const MAX_BYTES = 26 * 1024 * 1024;

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    if (message.rawSize > MAX_BYTES) {
      message.setReject("Message too large (25 MB at most).");
      return;
    }
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const recipient = message.to.toLowerCase();
    const signature = await signInbound(env.MAIL_INBOUND_SECRET, recipient, raw);
    // The safety copy goes out first, so the owner still gets the message even if the app is down.
    if (env.SAFETY_COPY_TO) await message.forward(env.SAFETY_COPY_TO).catch(() => undefined);
    let response: Response;
    try {
      response = await fetch(env.MAIL_INBOUND_URL, {
        method: "POST",
        headers: { "content-type": "message/rfc822", "x-bupulse-recipient": recipient, "x-bupulse-signature": signature },
        body: raw,
      });
    } catch {
      message.setReject("451 Temporary problem, please try again later.");
      return;
    }
    // Only the status goes to the log (wrangler tail), never addresses or content.
    console.log(`inbound ${response.status}`);
    if (response.status === 422) {
      message.setReject("550 No such mailbox here.");
      return;
    }
    if (!response.ok) {
      message.setReject("451 Temporary problem, please try again later.");
      return;
    }
    const result = (await response.json().catch(() => ({}))) as { forwardTo?: string[] };
    for (const target of result.forwardTo ?? []) {
      // Only addresses confirmed in Cloudflare (Email Routing, Destination addresses) can be forwarded to.
      await message.forward(target).catch(() => undefined);
    }
  },
};
