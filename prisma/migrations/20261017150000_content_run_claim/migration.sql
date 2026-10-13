-- "Create today's content" (docs/CONTENT.md): one run at a time per company, and the same request never twice
-- (double click, two tabs, two team members). Columns only: Business keeps its RLS and revoked grants.
ALTER TABLE "Business" ADD COLUMN "contentRunKey" TEXT;
ALTER TABLE "Business" ADD COLUMN "contentRunUntil" TIMESTAMP(3);
