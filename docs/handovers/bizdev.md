# Bizdev handover

Branch `bizdev` (worktree `/Users/macbook1/BuPulse-bizdev`). Local commits only; nothing pushed, merged to main or deployed.

## Done
- 19 Oct 2026: ManyChat teardown with REA, `docs/bizdev/competitor-manychat.md` (prices, every app module, sign-up
  funnel, affiliate model, tech stack, weaknesses in Rwanda, BuPulse vs ManyChat). Public pages only, no account created.
- `docs/bizdev/manychat-parity-plan.md`: every ManyChat feature, what blocks it (Meta verification needs RDB
  registration; TikTok comment-to-DM is impossible), phases.
- Owner decisions (19 Oct, before leaving): Composio now for Instagram/Facebook replies, direct Meta built but off;
  core engine first; a visual canvas builder; separate agents for social channels and for sales pieces. While the owner
  is away the main session (bupulse-fe) approves; this session reports SHAs to it.
- Conversations engine (docs/INBOX.md): contacts, conversations, messages, automations, runs and due jobs
  (migration `20261025100000_conversations_engine`, tables locked with RLS); the channel contract (`lib/inbox/types.ts`),
  `ingestInbound`, `sendToConversation`, the website channel; due jobs run in the minute cron after the publisher.
- Automations engine (`lib/automations/*`): triggers (keyword, comment keyword, any comment, Story mention, first
  message, default reply), steps (message with buttons, question, AI conversation, condition, actions, wait, hand-over,
  end), comment → public reply + private reply, numbered buttons on channels without buttons. The website chat goes
  through the inbox: automation replies come back in the chat response; team replies and delayed steps through
  `/api/widget/messages` (the bubble checks every 8 s while open).
- Features `inbox` and `automations`; migration `20261025100100_inbox_automations_plans`: inbox in BUSINESS, STANDARD,
  PRO; automations in PRO; RW add-on prices inbox 5,000 RWF (guess) and automations 25,000 RWF ("Social replies",
  docs/bizdev/PLAN.md). Both migrations are applied to the TEST database (19 Oct, `prisma migrate deploy` only).

- Inbox and Contacts pages (`/dashboard/inbox`, `/dashboard/contacts`), the Automations list with six Rwanda templates
  and the visual canvas (`/dashboard/automations/[id]`, React Flow 12.12.0) with publish checks and a phone preview.
  Guide pages 27 (Inbox and contacts) and 28 (Automations); developer notes `docs/INBOX.md`, `docs/AUTOMATIONS.md`.
- Merged from the agents (both finished):
  - `social` (docs/SOCIAL_INBOX.md, guide 24): Instagram/Facebook comments and DMs into the inbox through Composio
    (one `social.poll` job per switched-on account; hard budget 18,000 calls a month, Admin max 20,000), Meta webhooks
    built but off, private replies off by default; migration `20261025300000_social_inbox`.
  - `sales`: `docs/bizdev/PLAN.md` (9.05M RWF at month 4 = 156 clients; capacity and no-add-on scenarios; RDB by
    13 Nov 2026), `docs/bizdev/SALES_KIT.md`, pricing quiz + MoMo steps (guide 23), partner programme (guide 25,
    migration `20261025400000_partners`), revenue goal tracker in Admin (guide 26), free first-post preview behind an
    Admin switch that is OFF (guide 31, migration `20261025500000_first_post_preview`).
- QA (19 Oct, production build, throwaway Pro company, 1440 and 390 px): template → canvas → preview → publish →
  website chat answered by the automation with buttons → team reply from the Inbox reaches the chat bubble → bot quiet
  while the team answers → notes, tags, contact page, custom field. Fixed on the way: canvas boxes were hidden (React
  Flow measurements), page scroll in the inbox, phone header, Published state, unread badge.

- Live Instagram test (19 Oct, @bu.pulse on TEST, company LEAF Business GROUP LTD): reading DMs through Composio
  works (after "Allow access to messages"), the inbox and the BPTEST7 automation work, but every reply through
  Composio's shared Meta app is refused by Meta (2534022), a known Composio issue (#4847). Messages for Composio:
  `docs/bizdev/composio-instagram-issue.md`. Test switched off afterwards: inbox off on both accounts, the two
  "BPTEST7 …" automations PAUSED; LEAF's custom plan keeps inbox + automations (TEST only). 130 Composio calls used.
  The throwaway driver `tests/_live/social-live.db.test.ts` is not committed (delete it when no longer needed).
- After the test, reconnect @bu.pulse on Channels: a raw Graph API answer printed during the test contained its access
  token (not stored anywhere); reconnecting replaces it.

## Next
- Owner decisions (on bupulse-fe's list): register with RDB (top: unlocks Meta messaging and private replies); partner
  rates; Social replies packaging (25,000 RWF add-on recommended); USD rate; agents' pay; launch month; Kinyarwanda check;
  Composio beyond about 6–9 accounts (Meta route or a paid plan).
- When Meta approves: Admin → Services → Instagram and Facebook replies → route "meta", then test private replies on a
  test account and switch the flag on.
- Later phases of `docs/bizdev/manychat-parity-plan.md`: follow-up sequences UI, broadcasts (email + WhatsApp-ready),
  links/QR growth tools, automation analytics per step, agency workspaces, WhatsApp (after verification), Telegram.

## Also applied to TEST (19 Oct): `20261025300000_social_inbox` and `20261025400000_partners`
Rollback (only if needed):
```sql
BEGIN;
DROP TABLE IF EXISTS "PartnerPayout", "PartnerReferral", "Partner" CASCADE;
ALTER TABLE "Connection" DROP COLUMN IF EXISTS "inboxEnabled", DROP COLUMN IF EXISTS "inboxCursor";
DELETE FROM "_prisma_migrations" WHERE "migration_name" IN ('20261025300000_social_inbox', '20261025400000_partners');
COMMIT;
```
(The partners migration creates no enum types.)

Also applied (19 Oct): `20261025500000_first_post_preview` (one table). Rollback: `DROP TABLE IF EXISTS "FirstPostPreview" CASCADE;`
and delete its `_prisma_migrations` row.

## Rollback of the two engine migrations on TEST (only if needed)
```sql
BEGIN;
DELETE FROM "AddonPrice" WHERE "addonKey" IN ('inbox', 'automations') AND "regionKey" = 'RW';
UPDATE "PlanDefinition"
SET "featureKeys" = (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_array_elements_text("featureKeys") AS k WHERE k NOT IN ('inbox', 'automations')),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" IN ('BUSINESS', 'STANDARD', 'PRO') AND jsonb_typeof("featureKeys") = 'array';
ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_contactId_fkey";
DROP INDEX IF EXISTS "Lead_contactId_idx";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "contactId";
DROP TABLE IF EXISTS "Message", "AutomationRun", "Automation", "Conversation", "ContactTagLink", "ContactTag",
  "ContactField", "ContactIdentity", "Contact", "DueJob" CASCADE;
DROP TYPE IF EXISTS "ChannelKind", "ConversationStatus", "MessageDirection", "MessageAuthor", "MessageKind",
  "MessageStatus", "AutomationStatus", "AutomationRunStatus", "DueJobStatus";
DELETE FROM "_prisma_migrations" WHERE "migration_name" IN ('20261025100000_conversations_engine', '20261025100100_inbox_automations_plans');
COMMIT;
```

## Numbers to watch
- Composio calls per month (cap 18,000, free tier); DueJob FAILED count; automation runs started vs finished.
