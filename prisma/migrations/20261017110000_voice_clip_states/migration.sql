-- Voiceover review fixes (docs/VOICE_AND_MUSIC.md): a voiceover is claimed before it is spoken (one render asks the
-- voice service, others wait), audio paid for but not stored is kept until it is, and a voice that ran too long is
-- remembered so it is never spoken again. Additive.
ALTER TABLE "VoiceClip" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "VoiceClip" ADD COLUMN IF NOT EXISTS "pendingAudio" BYTEA;
ALTER TABLE "VoiceClip" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "VoiceClip" ALTER COLUMN "path" DROP NOT NULL;
ALTER TABLE "VoiceClip" DROP CONSTRAINT IF EXISTS "VoiceClip_status_check";
ALTER TABLE "VoiceClip" ADD CONSTRAINT "VoiceClip_status_check" CHECK ("status" IN ('speaking', 'spoken', 'ready', 'too_long'));
