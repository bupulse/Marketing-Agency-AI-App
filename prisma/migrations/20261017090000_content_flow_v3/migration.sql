-- Content flow v3 (docs/CONTENT.md): a day's content per product, campaign or General, built on content packs
-- (20261016140000_content_packs: packId, angle, network). Columns only: GeneratedContent keeps its RLS and revoked grants.
ALTER TABLE "GeneratedContent" ADD COLUMN "forDate" DATE;
ALTER TABLE "GeneratedContent" ADD COLUMN "mode" TEXT;
ALTER TABLE "GeneratedContent" ADD COLUMN "brief" TEXT;
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_mode_check" CHECK ("mode" IS NULL OR "mode" IN ('ai', 'describe', 'own'));
CREATE INDEX "GeneratedContent_businessId_forDate_idx" ON "GeneratedContent"("businessId", "forDate");
