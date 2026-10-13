-- Gallery videos review (docs/MEDIA.md). 20261017130000 raised the shared "media" bucket to 50 MB, which any signed-in
-- user can write to under their own folder (bupulse_own_folder_insert/update), skipping the server's checks and quotas.
-- Gallery videos now live in their own private bucket with no Storage policies (only server-issued signed upload
-- tokens, each tied to a reservation row), "media" goes back to 10 MB, and nobody's session may overwrite a "media"
-- object any more (no app code does: server uploads use the service key).

CREATE TABLE IF NOT EXISTS "MediaUploadReservation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaUploadReservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MediaUploadReservation_path_key" ON "MediaUploadReservation"("path");
CREATE INDEX IF NOT EXISTS "MediaUploadReservation_businessId_expiresAt_idx" ON "MediaUploadReservation"("businessId", "expiresAt");
ALTER TABLE "MediaUploadReservation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MediaUploadReservation" FROM PUBLIC, anon, authenticated, service_role;

-- Gallery videos made before this (test databases only; none in production) were stored in "media": their rows go,
-- and the daily storage sweep removes their files, now unrecorded.
DELETE FROM "MediaAsset" WHERE "kind" = 'video' AND "path" NOT LIKE '%/clips/%';

DO $$
DECLARE
  folder text := $f$bucket_id IN ('brand', 'designs')
    AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (storage.foldername(name))[1] = (SELECT public.bupulse_company_folder()))
    AND (bucket_id <> 'brand' OR (SELECT public.bupulse_can_manage_company()))$f$;
  writable text := folder || $w$
    AND NOT (SELECT public.bupulse_account_blocked())$w$;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'media';
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('gallery-videos', 'gallery-videos', false, 52428800, ARRAY['video/mp4', 'video/webm', 'image/jpeg'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800, allowed_mime_types = ARRAY['video/mp4', 'video/webm', 'image/jpeg'];
  -- UPDATE (overwrite) only in brand and designs now; INSERT, SELECT and DELETE are unchanged and never name
  -- gallery-videos, so a browser can neither write nor read there.
  DROP POLICY IF EXISTS bupulse_own_folder_update ON storage.objects;
  EXECUTE format('CREATE POLICY bupulse_own_folder_update ON storage.objects FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', folder, writable);
END
$$;
