# B Mail agent API

An outreach agent (Sellbird, in `~/Documents/Company/BuPulse/Harvey`) sends cold email from one B Mail mailbox and
reads the replies that arrive in it. Owner decisions (26 Nov 2026, multiple choice): **sales@bupulse.com**, **50 sends a
day** for the agent out of the team's 100, **with the B Mail signature**, keys made in the **Mail console**.

## Keys

- Mail console → **Sending and limits** → **Agent keys**: name, mailbox, sends a day (1–100), sender name (empty: as
  B Mail would, "Sales · BuPulse"), and whether the B Mail signature goes below each email. **Make key** shows the key
  (`bpm_live_…`) once. Only its peppered hash is stored (`hashApiKey`, lib/api/keys.ts), like the REST API keys.
- A key is tied to one mailbox: it sends only from it and reads only what arrives in it. **Revoke** stops it at once.
- The signature is the one of the admin who made the key (`MailAgentKey.memberId`).
- At most 10 active keys. 120 requests a minute per key (`mail-agent:<id>` in `RateLimit`).

## Endpoints

Base: `https://mail.bupulse.com/api/mail/agent/v1` (any host works: `/api/*` passes through). Every call sends
`Authorization: Bearer bpm_live_…`. Errors are JSON: `{ "error": { "code", "message" } }`.

| Call | What it does |
|---|---|
| `GET /me` | The key's mailbox, sender name, signature choice, and today's sends: `dailyLimit`, `sentToday`, `teamLeft`, `left`. |
| `POST /send` | `{ "to": "a@b.com" or { "name", "address" }, "subject", "text", "inReplyTo"? }`. One recipient, plain text (50,000 characters at most), a one-line subject. `inReplyTo` is the RFC Message-ID being answered: when that message is in the mailbox the email joins its conversation with In-Reply-To and References. **202** `{ id, threadId, messageId, status: "queued" }`. **429** `daily_limit` when the key's limit or the team's free sends are used up. |
| `GET /messages/:id` | Whether an email this key sent went out: `queued`, `sending`, `sent` or `failed` (with `error`), `providerId` (Resend's id), `sentAt`. |
| `GET /messages?cursor=&since=&limit=` | Mail that arrived in the mailbox after the cursor, oldest first (1–100 a page, 50 by default): `id`, `threadId`, `messageId`, `inReplyTo`, `references`, `from`, `to`, `cc`, `replyTo`, `subject`, `text`, `date`, `folder` (spam included, so the agent can tell), `authResults`, and each message's `cursor`. Keep `nextCursor` and send it next time; `hasMore` says another page is waiting. Without a cursor it starts at `since` (or 7 days back). Never drafts or what B Mail sent. |

## How sending works

- `sendAsAgent` (lib/mail/agent.ts) calls the composer's own `queueMessage` with `agent: { keyId, fromName, signature }`:
  no undo window (`sendAt` = now), the key's sender name, the signature only when the key says so, no quote of the
  message answered. The message row carries `agentKeyId`, and `authorEmail` is the admin who made the key.
- The route delivers it with `deliverDue()` right after answering (`after()`); page loads and `/api/cron/mail-send`
  catch anything left, as for the team's mail.
- Each email is one of the team's daily sends (`MailSendDay`, `MAIL_DAILY_LIMIT`), and the key stops at its own
  `dailyLimit` (emails with its `agentKeyId` since 00:00 UTC, failed ones not counted).

## Not done yet

- **Bounces.** Resend does not mail bounces back to the sender, and B Mail has no Resend webhook, so the agent never
  sees a bounce. Sellbird checks every address with a verifier before sending, which keeps bounces rare. Next step: a
  Resend `email.bounced` / `email.complained` webhook that marks the message and adds it to the agent feed.
- **Custom headers** (List-Unsubscribe): `resendSend` sends only Message-ID, In-Reply-To and References.
- **Resend's terms.** Resend's acceptable use policy forbids cold outreach. The owner chose this route knowing that;
  if Resend objects, the whole team's sending is affected. A separate sending service for agent mail would remove that
  risk.

## Tests

- `tests/mail/agent.test.ts`: key format, bearer parsing, the cursor, send input checks, the daily limit.
- `tests/mail/agent.db.test.ts`: the real route handlers against the TEST database (after the migrations
  `20261126120000_mail_agent_keys` and `20261126130000_mail_agent_keys_grants` are applied there):
  `RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/mail/agent.db.test.ts`
