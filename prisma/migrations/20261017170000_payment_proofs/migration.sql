-- Proof of a Mobile Money payment (docs/MOMO.md, "Proof"): a screenshot of the MoMo confirmation, stored in a private
-- bucket and tied to the payment row.
ALTER TABLE "ManualPayment" ADD COLUMN "proofPath" TEXT,
ADD COLUMN "proofBytes" INTEGER,
ADD COLUMN "proofType" TEXT;

-- A private Storage bucket for the screenshots. No policy names it, so signed-in users cannot list, read or write it:
-- the server issues a one-file signed upload URL for the client's own open payment (<userId>/<paymentId>/...), checks the
-- file, and the admin console reads it through short signed URLs. Skipped where the storage schema does not exist
-- (shadow database).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping the payment-proofs bucket';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('payment-proofs', 'payment-proofs', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
  ON CONFLICT (id) DO NOTHING;
END
$$;
