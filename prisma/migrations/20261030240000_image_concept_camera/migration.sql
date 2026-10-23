-- The image engine's anti-slop rules (docs/IMAGE_ANTI_SLOP.md): every picture is "shot" on a real camera and medium the
-- Director picks (lib/image-engine/realism.ts CAMERAS), least used first like the other axes, so it is remembered.

-- AlterTable
ALTER TABLE "ImageConcept" ADD COLUMN "camera" TEXT NOT NULL DEFAULT '';
