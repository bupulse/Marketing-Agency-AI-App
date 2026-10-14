-- Each piece's language at a version (docs/CONTENT.md, "Versions"): {caption, script, headlines}. "Generate again"
-- writes in the Brand's language of the day, so a caption written again in Kinyarwanda can sit next to an English
-- script; the post's panel names each piece's language. Null when it was not recorded (versions from before).

-- AlterTable
ALTER TABLE "PostVersion" ADD COLUMN "languages" JSONB;
