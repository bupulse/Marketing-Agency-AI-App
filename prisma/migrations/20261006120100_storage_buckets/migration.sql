-- Private Storage buckets. Files live under a top-level folder named after the owner's
-- auth.uid(), e.g. "<uid>/logo.png". Skipped where the storage schema does not exist
-- (Prisma's shadow database).
DO $$
DECLARE
  own_folder text := $f$bucket_id IN ('brand', 'media', 'designs')
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text$f$;
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping bucket setup';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    ('brand', 'brand', false, 5242880,
      ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
    ('media', 'media', false, 104857600,
      ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']),
    ('designs', 'designs', false, 10485760,
      ARRAY['image/png', 'image/jpeg', 'image/webp'])
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'bupulse_own_folder_select') THEN
    EXECUTE format('CREATE POLICY bupulse_own_folder_select ON storage.objects FOR SELECT TO authenticated USING (%s)', own_folder);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'bupulse_own_folder_insert') THEN
    EXECUTE format('CREATE POLICY bupulse_own_folder_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (%s)', own_folder);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'bupulse_own_folder_update') THEN
    EXECUTE format('CREATE POLICY bupulse_own_folder_update ON storage.objects FOR UPDATE TO authenticated USING (%1$s) WITH CHECK (%1$s)', own_folder);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'bupulse_own_folder_delete') THEN
    EXECUTE format('CREATE POLICY bupulse_own_folder_delete ON storage.objects FOR DELETE TO authenticated USING (%s)', own_folder);
  END IF;
END
$$;
