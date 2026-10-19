# Social inbox: Instagram and Facebook comments and DMs (developer notes)

The Instagram and Facebook channels of the conversations engine (the engine and its contract: `docs/INBOX.md`). A
business switches **Answer comments and messages** on per account on the Channels page; from then on that account's
new comments and DMs come into the inbox through `ingestInbound()`, and automations, the AI and the team answer through
the channel adapters. Owner steps: [guide page 20](guide/features/20-social-inbox.md).

## Two routes, one switch

| | BuPulse-Socials (Composio) | Meta direct |
| --- | --- | --- |
| Admin setting `inbox.meta.transport` | `composio` (default) | `meta` |
| Accounts it serves | `Connection.method = COMPOSIO` | `Connection.method = DIRECT` |
| How items arrive | Due jobs check each account (Composio has no triggers or webhooks for Meta) | Meta's webhooks, `app/api/meta/webhook` |
| How replies leave | Composio tools (`runTool`), private replies through Composio's proxy | Graph API with the account's own token (`loadCredentials`) |
| Needs | `COMPOSIO_API_KEY`, Composio switched on | `FACEBOOK_APP_SECRET` or `INSTAGRAM_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, Meta switched on, Meta's Advanced Access |
| Status (October 2026) | **On** | **Built, switched off**: Advanced Access needs a registered business |

One route is active at a time for every client (`lib/social/inbox/transport.ts`, `routeFor`). An account connected the
other way shows "Reconnect this account to answer its comments and messages" and its sends fail with code
`other_method`. While the route is `composio`, the webhook answers 200 and drops every delivery.

**Changing over to Meta direct** (once Meta approves BuPulse):
1. In the Meta app: Webhooks → Instagram and Page objects → callback `https://bupulse.com/api/meta/webhook`, verify
   token = the value of `META_WEBHOOK_VERIFY_TOKEN` (save it in Admin → Services → Meta first). Subscribe the fields
   `comments`, `messages`, `messaging_postbacks` (Instagram) and `feed`, `messages`, `messaging_postbacks` (Page).
2. Get Advanced Access for the extra permissions in `lib/social/inbox/scopes.ts` (App Review, `docs/META_APP_REVIEW.md`).
3. Set `SOCIALS_DIRECT=facebook,instagram` so new connections use BuPulse's own app.
4. Admin → Services → Instagram and Facebook replies → Change route → Meta direct. The action subscribes every
   switched-on DIRECT account to the webhook (`subscribeToWebhooks`). Clients whose accounts were connected through
   BuPulse-Socials reconnect them once.

The extra permissions are added to a direct sign-in only while the route is `meta` (`inboxScopesFor`, passed as
`extraScopes` to `SocialProvider.authorizeUrl` by `app/api/social/[network]/connect`). Today's sign-ins ask exactly
what they asked before (a test pins the URLs).

## Checking accounts (BuPulse-Socials)

Due jobs (`lib/jobs/due.ts`), registered in `lib/jobs/handlers.ts` by importing `lib/social/inbox/poll.ts`:

- `social.poll`, one pending job per account, `dedupeKey` `poll:<connectionId>`. Switching on schedules it now
  (`startPolling`); switching off cancels it. The handler (`runPoll`) checks the account and schedules its own next run.
  Because the runner clears the dedupe key only after the handler returns, the handler first lets go of its own key
  (`scheduleAgain`), then schedules the next job.
- `social.poll.sweep`, every hour: restarts any switched-on account with no job (after a crash, Composio switched back
  on, or the route switched back to `composio`).

One check (`pollAccount`, `lib/social/inbox/composio-poll.ts`):

1. **Comments.** `INSTAGRAM_GET_IG_USER_MEDIA` / `FACEBOOK_GET_PAGE_POSTS` for the last 7 days, with `comments_count`
   (Facebook: `comments.summary`) and the newest comments nested in the same call. Comments are taken only from posts
   whose count went up; when the nested list is missing, one `..._GET_IG_MEDIA_COMMENTS` / `FACEBOOK_GET_COMMENTS`
   call per such post.
2. **DMs.** `INSTAGRAM_LIST_ALL_CONVERSATIONS` (newest messages nested) / `FACEBOOK_GET_PAGE_CONVERSATIONS`, then only
   conversations updated since the cursor are opened (`..._LIST_ALL_MESSAGES` / `FACEBOOK_GET_CONVERSATION_MESSAGES`
   when the nested list is missing; Composio asks not to nest messages on Facebook).
3. Each item goes to `ingestInbound` with the platform id as `externalMessageId` (comments: `kind COMMENT`,
   `postExternalId`, `postCaption`; DMs: `MESSAGE`, or `STORY_MENTION`). The account's own comments and messages are
   skipped, and so is anything older than the moment it was switched on (`cursor.since`), so switching on never
   answers old comments.
4. DMs are passed **without** `threadExternalId`: the engine keys them `dm:<connectionId>:<person>`, exactly as it does
   for webhook DMs (which carry no conversation id), so switching routes keeps one conversation per person.

The cursor (`Connection.inboxCursor`, `lib/social/inbox/cursor.ts`): `since`, each post's count, the newest
conversation time `dmAt`, the last activity, and failures in a row with the last error (shown under the switch).

**Pace** (`lib/social/inbox/schedule.ts`): 5 minutes for 30 minutes after something new, 10 minutes up to two hours,
30 minutes when quiet; nothing between 22:00 and 07:00 in the business's time zone (`Business.timezone`); after two
failed checks in a row the wait doubles up to 6 hours. **Pacing**: when the month's remaining calls cannot cover every
switched-on account at that pace, the quiet interval stretches to `daytime minutes left × accounts × 2 / calls left`
(at most 4 hours), so checks slow down evenly instead of stopping in the last week.

## Budget: stay inside Composio's free calls

Composio's free plan has 100,000 calls a month, of which its managed (shared) Meta app includes 20,000; past that it
costs money. BuPulse counts every Composio call (`lib/social/inbox/budget.ts`), all businesses together, in one
`AdminSetting` row per UTC month (`composio.calls.YYYY-MM`):

- `composioApi` counts each call (posting, connecting, metrics too). Posting is counted but never stopped.
- The inbox check and inbox replies **reserve** each call first, atomically in SQL (`INSERT ... ON CONFLICT DO UPDATE
  ... WHERE used + n <= limit`), and pass `{ reserved: true }` so the call is not counted twice. A refused reservation
  means no call.
- Monthly limit `inbox.composio.monthlyCap`, default **18,000**, at most 20,000 (Admin → Services). Checks stop at the
  limit minus a reply reserve (500, or 5% when lower): replies can still go out for what was already found. A check
  also stops at 10 calls; the rest waits for the next check (counts only move on once read, so nothing is skipped).
- Admin → Services → Instagram and Facebook replies shows the month's count against the limit.

Estimate per account (a guess from the pace above, to be checked against real use): a quiet check is 2 calls, so a
quiet day (15 daytime hours, every 30 minutes) is about 60 calls and a month about **1,800**; an account with a busy
hour or two a day, about **2,500 to 3,000**. A business with Instagram and Facebook both switched on: roughly
**3,600 to 6,000** a month. The 17,500 calls for checks therefore cover about 6 to 9 accounts at full pace; with more,
pacing slows the quiet checks (20 accounts: about every hour; 50: about every 2.5 hours). Scaling past a pilot needs
the Meta direct route (webhooks cost no calls) or a paid Composio plan (owner's decision).

## Sending (`lib/inbox/channels/{instagram,facebook}.ts`, `lib/social/inbox/outbound.ts`)

Capabilities: images, public comment replies, `windowHours: 24`; no buttons or quick replies (link buttons are added
to the text as "Title: url"). `privateReply` is reported true only when `inbox.privateReply.confirmed` is on (a getter
over the settings the last `available()` read).

| | BuPulse-Socials | Meta direct |
| --- | --- | --- |
| DM | `INSTAGRAM_SEND_TEXT_MESSAGE` / `INSTAGRAM_SEND_IMAGE`; `FACEBOOK_SEND_MESSAGE` / `FACEBOOK_SEND_MEDIA_MESSAGE` (`messaging_type RESPONSE`) | `POST /me/messages` (Instagram) or `/{page}/messages` |
| Comment reply | `INSTAGRAM_POST_IG_COMMENT_REPLIES` (300 characters, clipped); `FACEBOOK_CREATE_COMMENT` | `POST /{comment}/replies` (Instagram), `/{comment}/comments` (Facebook) |
| Private reply | Composio proxy `POST /{account}/messages` with `recipient.comment_id` | Graph, same body |

Errors become `ChannelSendError` with a plain message and a code: `window` (outside 24 hours), `comment_thread` (a DM
to someone who only commented: use a private reply), `private_reply_used`, `private_reply_off`, `budget`, `auth`,
`other_method`, `inbox_off`, `rate_limit` (retry), `temporary` (retry).

**Private replies are off by default.** Composio has no tool for them. Through the proxy they need Meta permissions
(`instagram_manage_comments` + `pages_messaging` with Facebook Login, or `instagram_business_manage_messages` with
Instagram Login, all with Advanced Access) that Composio's shared app may not hold, and for Facebook the proxy may use
the person's token instead of the Page's. Switch the flag on only after a private reply worked on a test account.

## Meta webhook (`app/api/meta/webhook/route.ts`)

- `GET`: answers `hub.challenge` when `hub.mode=subscribe` and `hub.verify_token` equals `META_WEBHOOK_VERIFY_TOKEN`
  (constant-time compare); 403 otherwise, and always 403 when the variable is empty.
- `POST`: route not `meta` → 200 `{ dropped: true }`. Otherwise checks `X-Hub-Signature-256` (HMAC-SHA256 of the raw
  body with `FACEBOOK_APP_SECRET`, `INSTAGRAM_APP_SECRET` or `META_APP_SECRET`), reads the payload (`readWebhook`,
  `lib/social/inbox/meta-webhook.ts`): Instagram `comments` changes and `messaging` (DMs, quick-reply taps as
  `buttonId`, postbacks, story mentions), Page `feed` comment additions and Messenger `messaging`; echoes and the
  account's own comments are skipped. Each item goes to every switched-on DIRECT connection of that account
  (`deliverWebhookItems`). An ingest failure answers 500 so Meta retries (stored once anyway).

## Files

| Part | Files |
| --- | --- |
| Settings, budget, route | `lib/social/inbox/settings.ts`, `budget.ts`, `transport.ts`, `scopes.ts` |
| Checks | `lib/social/inbox/poll.ts`, `composio-poll.ts`, `cursor.ts`, `schedule.ts`, `mapping.ts` |
| Sending | `lib/social/inbox/outbound.ts`, `lib/inbox/channels/instagram.ts`, `lib/inbox/channels/facebook.ts` |
| Meta direct | `app/api/meta/webhook/route.ts`, `lib/social/inbox/meta-webhook.ts`, `meta-inbound.ts`, `meta-subscribe.ts` |
| Channels page | `lib/social/inbox/accounts.ts`, `components/connections/inbox-switch.tsx`, `setInboxEnabledAction` in `app/dashboard/connections/actions.ts` |
| Admin | `components/admin/social-inbox-panel.tsx`, `lib/social/inbox/admin.ts`, `app/admin/(console)/(system)/services/inbox-actions.ts` |
| Composio client | `composioApi` counts calls; `runTool(..., { reserved })`; `proxyRequest` (`lib/social/composio/client.ts`) |
| Database | `Connection.inboxEnabled`, `Connection.inboxCursor` (migration `20261025300000_social_inbox`, columns only); `AdminSetting` keys `inbox.meta.transport`, `inbox.composio.monthlyCap`, `inbox.privateReply.confirmed`, `composio.calls.YYYY-MM` |
| Tests | `tests/social-inbox/*.test.ts` |

## Open points

- Plans: the switch, the checks and webhook deliveries need the `inbox` feature (`hasFeature`); a business that loses
  it stops being checked at its next run.
- Composio bills by its own monthly cycle; BuPulse counts by UTC calendar month, with a 2,000-call margin under 20,000.
- `proxy.ts` still runs on `/api/meta/webhook` (one Supabase session read per delivery); adding `api/meta/webhook` to
  its matcher exclusions would save it.
