# Automations (developer notes)

ManyChat-style automations on BuPulse: automatic answers to messages, comments and Story mentions, drawn on a canvas.
Contacts, conversations and channels are in `docs/INBOX.md`; Instagram and Facebook in `docs/SOCIAL_INBOX.md`. Owner
steps: [guide page 27](guide/features/27-automations.md). The plan behind it: `docs/bizdev/manychat-parity-plan.md`.

## The graph (`lib/automations/graph.ts`, shared by the canvas and the engine)

An automation is `{ nodes, edges }` (zod `graphSchema`). One `trigger` node, then steps joined by edges. An edge leaves a
step through an exit (`sourceHandle`): `next`; a button id; `answered` / `no_answer`; `yes` / `no`; `done`. `exitsOf`
lists a step's exits, `nextNodeId` follows one, `graphProblems` says in plain words what stops publishing (no trigger,
no channel, no keyword, comment triggers on a channel without comments, empty texts, missing fields, steps not
connected to the trigger, lines to missing steps).

| Step | Data | Exits | What the engine does |
|---|---|---|---|
| `trigger` | `kind` (keyword, comment_keyword, any_comment, story_mention, first_message, default_reply), `channels`, `keywords`, `match` (contains / exact), `postIds`, `publicReplies` | next | starts a run |
| `message` | `text` (variables), up to 3 `buttons` (title, optional url), `imageUrl` | next, one per button without url | sends; waits for a tap when a button exit is joined |
| `question` | `text`, `saveTo` (name, email, phone, field + `fieldKey`), `validate`, `retryText`, `timeoutMinutes`, `quickReplies` | answered, no_answer (with a timeout) | sends, waits for the answer, checks it (2 retries), saves it |
| `ai` | `goal`, `context`, `maxTurns` | done | AI replies from the knowledge base towards the goal until it is reached or `maxTurns` |
| `condition` | `rules` (has_tag, no_tag, field_equals, field_set, has_email, has_phone, channel_is, text_contains), `mode` all/any | yes, no | branches |
| `action` | `actions` (add_tag, remove_tag, set_field, notify_team, save_lead, subscribe_email, unsubscribe, webhook) | next | runs them; one failing never stops the run |
| `wait` | `minutes` | next | a due job `automation.resume` |
| `handover` | `text`, `note`, `pauseHours` | — | pauses automations in the conversation, adds a team note, alerts the team, ends |
| `end` | — | — | ends |

Variables in texts (`renderText`, `lib/automations/match.ts`): `{{first_name}}`, `{{name}}`, `{{email}}`, `{{phone}}`,
`{{business}}`, `{{field.<key>}}`. Missing ones become empty and the spacing is tidied ("Hi {{first_name}}!" → "Hi!").

## Which automation answers (`lib/automations/engine.ts`, `handleInbound`)

For every new inbound item stored by `ingestInbound` (`lib/inbox/ingest.ts`):

1. A teammate took over (`Conversation.botPausedUntil` in the future) → nothing; the website chat's AI stays quiet too.
2. The plan lacks `automations` → not handled (the website chat answers with its own AI as before).
3. A keyword typed on purpose (score ≥ 50) wins over an older run that waits; otherwise a run of this contact on this
   channel waiting for a reply, a button, an AI turn or the first DM after a comment goes on (`resume`).
4. Otherwise the most specific live trigger starts a new run (`pickAutomation`: keyword and comment keyword 50 (+5 exact,
   + longer keywords), Story mention 40, any comment 30 (+5 for chosen posts), first message 20, default reply 10;
   ties go to the most recently changed). A new run stops the contact's older runs of the same automation.

Comment triggers: the public reply under the comment first, then the first message as a Meta **private reply** when the
channel can (`capabilities.privateReply`, an Admin flag, docs/SOCIAL_INBOX.md); otherwise as a public reply under the
comment. After either, the run waits (`dm_open`) until the person writes a DM, because Meta allows nothing more before.
A run that started on a comment moves to the DM conversation when they write there.

Channels without buttons get them as a numbered list; an answer matches a button by tap id, typed title or number
(`messageForChannel`, `buttonFor`).

Runs (`AutomationRun`): RUNNING → WAITING (`waitingFor` reply, button, ai, delay, dm_open) → DONE, or STOPPED (replaced,
paused, taken over, step deleted) or FAILED (the send failed; the message's error is in the inbox). A run walks at most
25 steps per pass (`MAX_STEPS_PER_PASS`), a guard against graphs that loop. Waiting runs are claimed atomically
(`claim`), so two messages at once never resume one twice.

## Publishing (`lib/automations/service.ts`)

The canvas saves the draft (`Automation.graph`). **Publish** runs `graphProblems` plus a check that saved fields exist,
then copies the draft to `liveGraph`, bumps `version`, sets `status` LIVE, `triggerType` and `channels`. The engine only
reads `liveGraph`, so editing never changes what runs until the next publish. Pause stops the runs in progress.

## Money

- An AI step costs one chat reply of the plan (`consumeUsage(owner, "chat")`, refunded when the AI fails) and is
  recorded in the AI ledger as the website chat's feature (`WIDGET_FEATURE`), inside its share of the allowance.
- Other steps cost nothing on the website. On Instagram/Facebook each send is a Composio call, inside the monthly
  budget (docs/SOCIAL_INBOX.md).
- Plans (migration `20261025100100_inbox_automations_plans`): `automations` in PRO; in Rwanda the add-on "Social replies"
  (`AddonPrice` automations, 25,000 RWF a month with 1,000 chat replies, `FEATURE_INCLUDES` in lib/offers/shared.ts).

## Templates (`lib/automations/templates.ts`)

Comment PRICE → DM, Welcome menu, Book a visit, Answer anything with AI, Giveaway, Follow up the next day. Each one
publishes as it is (`tests/automations/templates.test.ts`); fields a template saves to are created with it.

## Files

| Part | Path |
|---|---|
| Pages | `app/dashboard/automations/page.tsx` (list + templates), `app/dashboard/automations/[id]/page.tsx` (canvas) |
| Actions | `app/dashboard/automations/actions.ts` (`create`, `save`, `publishAutomation`, `pause`, `copy`, `destroy`; permission `automations`) |
| Components | `components/automations/automations-list.tsx`, `editor.tsx` (React Flow canvas, `@xyflow/react` 12.12.0), `step-form.tsx` (the side panel), `preview.tsx` (phone preview, nothing sent) |
| Engine | `lib/automations/{graph,match,engine,ai,dispatch,jobs,service,templates}.ts` |
| Jobs | `automation.resume`, `automation.timeout` (`lib/automations/jobs.ts`, run by `lib/jobs/due.ts` from the minute cron) |
| Webhook | `automation.action` (the "Send to webhook" action; lib/webhooks/events.ts) |
| Tests | `tests/automations/{match,graph,templates}.test.ts`, `tests/automations/engine.db.test.ts` (database, `RUN_DB_TESTS=1`) |
