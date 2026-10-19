# Conversations engine: contacts, inbox, channels (developer notes)

The engine behind the ManyChat-style features (plan: `docs/bizdev/manychat-parity-plan.md`). Automations:
`docs/AUTOMATIONS.md`. Owner steps: [guide page 27](guide/features/27-inbox-and-contacts.md) and [28](guide/features/28-automations.md).

## Tables (migration `20261025100000_conversations_engine`)

| Table | What it is |
| --- | --- |
| `Contact` | One real person a business talks to, on any channel. Name, email, phone, language, custom `fields` (JSON), `emailOptIn`, `unsubscribedAt`, `lastSeenAt`. `mergedIntoId` hides a merged duplicate. `Lead.contactId` links leads to it. |
| `ContactIdentity` | How the contact is known on one channel: `(businessId, channel, externalId)` is unique (Instagram-scoped id, Facebook PSID, website visitor id, phone). `connectionId` = the connected account they wrote to. |
| `ContactTag`, `ContactTagLink` | Tags per business and which contacts carry them. |
| `ContactField` | Custom fields the business defines (`key`, `label`, `type`, `options`). |
| `Conversation` | One thread on one channel: a website chat session (`chatSessionId`), a DM thread (`externalThreadId`), or one person's comments on one account (`comments:<connectionId>:<externalId>`). Status OPEN/CLOSED, `assigneeId`, `botPausedUntil` (a person took over), `unread`, `preview`, `lastInboundAt` (Meta's 24-hour window). |
| `Message` | Every message in a conversation: direction, author (CONTACT, BOT, AGENT, SYSTEM), kind (MESSAGE, COMMENT, COMMENT_REPLY, STORY_MENTION, NOTE), `externalId` (unique per conversation, so the same platform message is stored once), `postExternalId` for comments, `status` (RECEIVED, QUEUED, SENT, FAILED) and `error`. |
| `Automation`, `AutomationRun` | Automations drawn on the canvas and each contact's run through one (docs/AUTOMATIONS.md). |
| `DueJob` | Work to do at a time (`lib/jobs/due.ts`). |

## Channels: the contract (`lib/inbox/types.ts`)

A channel module (website, Instagram, Facebook, WhatsApp...) does only two things:

1. **Inbound.** When something arrives, build an `InboundEvent` and call `ingestInbound(event)` (`lib/inbox/ingest.ts`).
   Never write contacts, conversations or messages yourself. Pass `externalMessageId` (the platform id) so a message seen
   twice (polling!) is stored once; `ingestInbound` returns `{ duplicate: true }` for it and does nothing else. For a
   comment pass `kind: "COMMENT"`, `postExternalId` and, if known, `postCaption`.
2. **Outbound.** Register a `ChannelAdapter` with `registerChannel()` (`lib/inbox/channels.ts`) and import the module in
   `lib/inbox/all-channels.ts`. The adapter says what it can do (`capabilities`: buttons, quick replies, images, public
   comment replies, private replies, the reply window in hours) and implements `available()`, `send()`, and optionally
   `replyToComment()` and `privateReply()`. Throw `ChannelSendError(message, retry)` with a plain-English message when
   sending is impossible; the inbox shows it.

The engine sends with `sendToConversation(conversationId, message, options)` (`lib/inbox/send.ts`): it stores the
message (QUEUED), checks the channel is available and the 24-hour window, calls the adapter, and marks it SENT or FAILED.

After `ingestInbound` stores a message it calls `dispatchInbound()` (`lib/automations/dispatch.ts`), where automations
and the AI reply decide what to answer. Channels never call automations directly.

## Due jobs (`lib/jobs/due.ts`)

`scheduleJob({ kind, runAt, payload, businessId, dedupeKey })` and `registerJobHandler(kind, handler)`. Import the
module that registers handlers in `lib/jobs/handlers.ts`. The every-minute cron (`app/api/cron/publish`) runs
`runDueJobs()` after the publisher (every 5 minutes on Netlify), recorded as the cron run "due-jobs". Handlers must be
safe to run twice; a thrown error retries after 1, 2, 4, 8 minutes, then the job is FAILED. A `dedupeKey` keeps one
pending job per key (for example `poll:<connectionId>` for a social account check).

## Who builds what (October 2026)

- **Core engine (bizdev session):** contacts, inbox UI, automations and the canvas builder, the website channel, the AI
  reply step.
- **Social replies (separate agent):** Instagram and Facebook channels: through Composio now (checked by due jobs), and
  direct Meta webhooks built but switched off, with one Admin switch to change over (`docs/SOCIAL_INBOX.md`).
- **Sales pieces (separate agent):** the plan quiz on /pricing and the partner programme (`docs/PARTNERS.md`).
