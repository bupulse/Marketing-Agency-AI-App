-- Video Studio (docs/VIDEO_APP_INTEGRATION.md): the sound of a studio MP4. `music`: the library track mixed into it, so
-- its credit line (when its licence asks for one) goes on the posts. `voiceCredits`, `voicePeriodStart` and
-- `voiceReservedAt`: a voice-over's credits while its take is being made, so the video-jobs sweep can give back a
-- reservation whose request died. New columns only.

-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN     "music" JSONB,
ADD COLUMN     "voiceCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voicePeriodStart" TIMESTAMP(3),
ADD COLUMN     "voiceReservedAt" TIMESTAMP(3);

ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_voiceCredits_check" CHECK ("voiceCredits" >= 0);
