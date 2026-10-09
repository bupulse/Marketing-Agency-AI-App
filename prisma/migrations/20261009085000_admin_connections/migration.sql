-- Admin console: connections views. Support can switch a client's website chat off; the owner then sees it
-- switched off and cannot turn it back on until support does. No new table, so no new RLS (ChatWidget already has it).
ALTER TABLE "ChatWidget" ADD COLUMN "disabledByAdminAt" TIMESTAMP(3), ADD COLUMN "disabledByAdminReason" TEXT;
