-- A payment received for an invoice that did not match its total: shown to the admin to check and mark paid.
-- New nullable column only; nothing is rewritten.
ALTER TABLE "Invoice" ADD COLUMN "paymentReview" JSONB;
