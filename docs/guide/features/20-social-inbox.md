# Instagram and Facebook replies (social inbox)

Clients can bring the comments and direct messages (DMs) of their Instagram and Facebook accounts into BuPulse, so
automations, the AI and their team answer them from one inbox. Each connected Instagram or Facebook account has a
switch on the Channels page: **Answer comments and messages**. Only comments and messages that arrive after the switch
is turned on come in; older ones are never answered.

**Page:** `/dashboard/connections` (the switch under each Instagram and Facebook account); the admin side is in
**Admin → Services → Instagram and Facebook replies**. **Plans:** the switch shows for every account on the Channels
page (which needs the `calendar` feature); which plans include the inbox itself is set by the inbox and automations.

## What the client sees

- Under each Instagram and Facebook account: **Answer comments and messages**, an on/off switch, and one line below it:
  - off: what the switch does;
  - on: "New comments and messages are checked every few minutes. Last check 4 min ago." (or what went wrong on the last
    check, for example a missing permission);
  - "Reconnect this account to answer its comments and messages in BuPulse." when the account was connected another
    way than the one BuPulse uses today. The switch cannot be turned on until the account is reconnected.
- Turning it on says "Switched on. New comments and messages will appear in your inbox within a few minutes."

## How to use it (client)

1. Open **Channels** and connect the Instagram (Business or Creator) or Facebook Page account, if it is not there yet.
2. Turn **Answer comments and messages** on under that account.
3. Within a few minutes new comments and DMs appear in the inbox. Automations can answer them; a person can take over
   any conversation.
4. Turn it off any time: BuPulse stops reading that account. Nothing already in the inbox is deleted.

Rules from Instagram and Facebook that BuPulse follows:

- A DM can be answered only within **24 hours** of the person's last message. After that the inbox shows "Instagram
  only allows replies within 24 hours of the person's last message." and the client answers in the Instagram or
  Facebook app.
- Someone who only commented has no DM thread. BuPulse can answer under the comment (public reply). A **private reply**
  (one DM per comment, within 7 days) is available only once the BuPulse team has switched it on.
- Replies under Instagram comments are at most 300 characters; longer ones are shortened.
- People can always reach a real person: every conversation is in the team's inbox.

## What the owner (admin) does

**Admin → Services → Instagram and Facebook replies** shows:

- **Route**: how comments and DMs travel. Today **BuPulse-Socials (Composio)**: BuPulse checks each switched-on account
  every few minutes (every 5 minutes after activity, every 30 minutes when quiet, never between 22:00 and 07:00 in the
  client's time zone). **Meta direct** is built but switched off: it gets comments and DMs instantly from Meta, but
  needs Meta to approve BuPulse's app first, which needs a registered business.
- **Composio calls this month**: a bar with the month's count against the limit. Composio's free plan includes 20,000
  calls a month for Meta; above that it costs money.
- **Accounts switched on**, and how many checks are waiting.
- **Private replies**: on or off.

Steps:

1. **Keep the limit inside the free calls.** Press **Monthly limit**. The default is 18,000 (the most allowed is
   20,000). Checks stop 500 calls before it, so replies can still go out; posting is never stopped. When the limit is
   reached, checks wait until the 1st of next month and clients answer in the Instagram or Facebook app.
2. **Watch the bar** once a week. One account uses roughly 1,800 to 3,000 calls a month (a guess until real use shows
   it); a client with both Instagram and Facebook switched on about 3,600 to 6,000. With many accounts, BuPulse checks
   quiet accounts less often so the calls last the whole month.
3. **Private replies (optional).** Only after one worked on a test account: press **Switch private replies on**. If it
   does not work, leave it off; clients still answer under comments.
4. **Change to Meta direct (later).** Only after Meta has approved BuPulse's app: follow the steps in
   `docs/SOCIAL_INBOX.md` ("Changing over to Meta direct"), then press **Change route** → Meta direct. Clients whose
   accounts were connected through BuPulse-Socials reconnect them once.

## Limits and settings

- Checks run in the background every 5 minutes at most (the minute cron, on Netlify every 5 minutes).
- Only the last 7 days of posts are watched for new comments.
- BuPulse never reads or answers anything older than the moment an account's switch was turned on.
- Settings (all audited): `inbox.meta.transport`, `inbox.composio.monthlyCap`, `inbox.privateReply.confirmed`.

## For developers

### Where it lives

| Part | Path |
|---|---|
| Developer notes | [docs/SOCIAL_INBOX.md](../../SOCIAL_INBOX.md); the engine contract in [docs/INBOX.md](../../INBOX.md) |
| Channel adapters | `lib/inbox/channels/instagram.ts`, `lib/inbox/channels/facebook.ts` (registered in `lib/inbox/all-channels.ts`) |
| Sending | `lib/social/inbox/outbound.ts` |
| Checks (BuPulse-Socials) | `lib/social/inbox/poll.ts` (due jobs `social.poll`, `social.poll.sweep`, registered in `lib/jobs/handlers.ts`), `composio-poll.ts`, `cursor.ts`, `schedule.ts`, `mapping.ts` |
| Budget and settings | `lib/social/inbox/budget.ts`, `settings.ts`, `transport.ts`, `scopes.ts` |
| Meta direct | `app/api/meta/webhook/route.ts`, `lib/social/inbox/meta-webhook.ts`, `meta-inbound.ts`, `meta-subscribe.ts` |
| Channels page | `components/connections/inbox-switch.tsx`, `lib/social/inbox/accounts.ts`, `setInboxEnabledAction` in `app/dashboard/connections/actions.ts` |
| Admin | `components/admin/social-inbox-panel.tsx` on `app/admin/(console)/(system)/services/page.tsx`, actions in `services/inbox-actions.ts`, view in `lib/social/inbox/admin.ts` |
| Database | `Connection.inboxEnabled`, `Connection.inboxCursor` (migration `20261025300000_social_inbox`); `AdminSetting` rows for the settings and `composio.calls.YYYY-MM` |
| Tests | `tests/social-inbox/*.test.ts` |

Environment variables (names only): `COMPOSIO_API_KEY`, `FACEBOOK_APP_SECRET`, `INSTAGRAM_APP_SECRET`,
`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` (saved in Admin → Services → Meta).

### Key functions

- `pollAccount` (`composio-poll.ts`) — one check: posts with comment counts, then conversations; every call reserved first.
- `runPoll`, `startPolling`, `stopPolling`, `sweep` (`poll.ts`) — the due-job chain per account.
- `nextCheckAt`, `pacedMinutes`, `isNight` (`schedule.ts`) — the pace, the monthly pacing and the night pause.
- `reserveComposioCalls`, `countComposioCalls`, `pollLimit` (`budget.ts`) — the atomic monthly count.
- `sendMessage`, `replyToComment`, `privateReply`, `sendError` (`outbound.ts`) — both routes, plain-English errors.
- `readWebhook`, `verifySignature` (`meta-webhook.ts`) — Meta's deliveries.
- `inboxScopesFor` (`scopes.ts`) — the extra permissions, only on direct sign-ins and only on the Meta route.
