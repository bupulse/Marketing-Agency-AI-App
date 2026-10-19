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

## Agents (worktrees under /Users/macbook1/BuPulse/.claude/worktrees)
- `sales`: PLAN.md (b6c2273, d4f605f), SALES_KIT.md (561adb7, c5a2ae0), pricing quiz + MoMo steps (a3034ed), partner
  programme next (migration `20261025400000_partners`).
- `social`: Instagram/Facebook channels (Composio polling capped at 18,000 calls a month, Meta webhooks off), migration
  `20261025300000_social_inbox`.

## Next
- Inbox, Contacts and Automations pages (canvas with @xyflow/react), templates for Rwanda, docs/AUTOMATIONS.md, guide
  pages, engine tests on TEST data; merge the agents' branches into bizdev.

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
