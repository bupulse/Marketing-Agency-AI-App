-- Video Studio (docs/VIDEO_APP_INTEGRATION.md): the library track mixed into a studio MP4, so its credit line (when its
-- licence asks for one) goes on the posts. A new nullable column only.

-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN     "music" JSONB;
