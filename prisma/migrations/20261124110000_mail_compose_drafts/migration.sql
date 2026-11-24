-- B Mail compose (docs/mail-crm/GAPS.md section C): what the composer had open, kept on a draft (and on the first
-- message of a send, so Undo puts the composer back as it was): recipients as typed (departments included), the body
-- without the signature, the message answered or forwarded and the mode. Additive only.

ALTER TABLE "MailMessage" ADD COLUMN IF NOT EXISTS "draft" JSONB;
