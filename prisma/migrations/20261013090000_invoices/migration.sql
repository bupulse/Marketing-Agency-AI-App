-- Invoices (docs/INVOICES.md): the "No trial, send invoice" activation after a demo, the admin's invoice editor, the
-- PDF, Mobile Money payment with the invoice number as the reference, and the client's invoice list. New table, new
-- nullable column and a sequence only: nothing is rewritten and existing payments keep their references.

-- Invoice numbers come from a sequence: nextval is atomic, so two invoices created at the same instant never share a
-- number. Numbers are not reused (a voided invoice keeps its number), as invoices should be.
CREATE SEQUENCE IF NOT EXISTS "Invoice_number_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "taxRatePercent" DOUBLE PRECISION,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "notes" TEXT,
    "billingEmail" TEXT,
    "planKey" TEXT,
    "interval" "BillingInterval",
    "billTo" JSONB,
    "seller" JSONB,
    "pdfPath" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reminderSentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Invoice_status_check" CHECK ("status" IN ('draft', 'sent', 'paid', 'void')),
    CONSTRAINT "Invoice_amounts_check" CHECK ("subtotalMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0)
);
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_businessId_createdAt_idx" ON "Invoice"("businessId", "createdAt");
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");
-- One draft per company: "Activate account -> send invoice" clicked twice (or by two admins) opens the same draft.
CREATE UNIQUE INDEX "Invoice_one_draft_per_business" ON "Invoice"("businessId") WHERE "status" = 'draft';
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A Mobile Money payment can settle an invoice; its reference is then the invoice number, shared by every attempt at
-- that invoice (a rejected one and the retry). Other payments keep a unique BP-XXXX reference as before.
ALTER TABLE "ManualPayment" ADD COLUMN "invoiceId" TEXT;
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ManualPayment_invoiceId_idx" ON "ManualPayment"("invoiceId");
CREATE INDEX "ManualPayment_reference_idx" ON "ManualPayment"("reference");
DROP INDEX IF EXISTS "ManualPayment_reference_key";
CREATE UNIQUE INDEX "ManualPayment_reference_key" ON "ManualPayment"("reference") WHERE "invoiceId" IS NULL;
-- One live payment per invoice: an invoice is never paid twice, and never has two open payments.
CREATE UNIQUE INDEX "ManualPayment_invoice_live_key" ON "ManualPayment"("invoiceId") WHERE "status" IN ('pending', 'confirmed') AND "invoiceId" IS NOT NULL;

-- Same rules as the other internal tables: RLS on with no policies, no grants for the API roles (Prisma connects as
-- postgres). The sequence too (the default privileges already cover it; explicit for clarity).
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Invoice" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE "Invoice_number_seq" FROM PUBLIC, anon, authenticated, service_role;

-- A private Storage bucket for invoice PDFs and the invoice logo. No policy names it, so signed-in users cannot read or
-- write it: the app reads and writes it with the service key after its own checks, and clients download through an
-- auth-checked route (app/api/invoices/[id]/pdf). Skipped where the storage schema does not exist (shadow database).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping the invoices bucket';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('invoices', 'invoices', false, 5242880, ARRAY['application/pdf', 'image/png', 'image/jpeg'])
  ON CONFLICT (id) DO NOTHING;
END
$$;
