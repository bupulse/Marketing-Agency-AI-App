-- Social inbox (docs/SOCIAL_INBOX.md): a business switches "Answer comments and messages" on per Instagram or Facebook
-- account, and the inbox check keeps what it has already seen. Columns only: no new table, so no RLS change.
ALTER TABLE "Connection" ADD COLUMN "inboxEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Connection" ADD COLUMN "inboxCursor" JSONB;
