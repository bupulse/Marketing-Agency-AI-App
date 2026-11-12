-- The Ad Brain's 20261110233000_ad_brain_video_engine re-adds "VideoJob_engine_check" without 'upload' (main's
-- 20261112100000_video_upload_engine). Where that older migration is applied after main's (production, when ad-brain
-- deploys), every upload would fail (23514). This one runs last in any order and keeps every engine. Widened, never
-- narrowed: existing rows keep their values.
ALTER TABLE "VideoJob" DROP CONSTRAINT IF EXISTS "VideoJob_engine_check";
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_engine_check" CHECK ("engine" IN ('motion', 'premium3d', 'seedance', 'adbrain', 'upload'));
