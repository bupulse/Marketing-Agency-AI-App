-- Knowledge base, part 1 (docs/KNOWLEDGE_BASE.md): Company profile (Business.profile), Products, Campaigns, product
-- and campaign photo albums in the gallery, and the move from Projects.
--
-- Every Project is copied into a Product (product, listing, service, project) or a Campaign (event, offer, anything
-- else) with the SAME id, so every old projectId keeps pointing at the same thing. The mapping is
-- lib/knowledge/legacy.ts mapLegacyProject() (tests/knowledge/legacy.test.ts checks the SQL below against it). Project
-- photos become gallery photos (MediaAsset rows on their existing object paths) linked to the new album.
-- GeneratedContent gains businessId (so content is scoped without going through a project) and productId /
-- campaignId; Design, Post and ProductSync gain productId (and campaignId). projectId stays, readable, on all of them.
-- Nothing is dropped; the Project table is kept read-only for older builds and the public API's legacy routes.
--
-- Deploy order: run this migration, then the new build. Triggers below fill the new columns for rows an OLDER build
-- writes in between (it only knows projectId). Projects an older build creates after this migration are not copied:
-- run the BACKFILL block again (it is idempotent) if an older build ran for a while after the migration.

-- ---- Types and columns ------------------------------------------------------------------------------------------
CREATE TYPE "ProductKind" AS ENUM ('PHYSICAL', 'DIGITAL', 'SERVICE');
CREATE TYPE "PriceModel" AS ENUM ('FIXED', 'FROM', 'PER_MONTH', 'PER_YEAR', 'PER_UNIT', 'ON_REQUEST');
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');
CREATE TYPE "CampaignType" AS ENUM ('EVENT', 'OFFER', 'PROMOTION', 'LAUNCH', 'OTHER');

ALTER TABLE "Business" ADD COLUMN "profile" JSONB;

-- businessId is added nullable, backfilled, then made NOT NULL (below).
ALTER TABLE "GeneratedContent" ADD COLUMN "businessId" TEXT,
ADD COLUMN "campaignId" TEXT,
ADD COLUMN "productId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "Design" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "ProductSync" ADD COLUMN     "productId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "priceModel" "PriceModel" NOT NULL DEFAULT 'ON_REQUEST',
    "priceAmount" INTEGER,
    "currency" TEXT NOT NULL,
    "priceNote" TEXT,
    "usps" TEXT[],
    "features" TEXT[],
    "targetCustomer" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" DATE,
    "endsAt" DATE,
    "priceInfo" TEXT,
    "highlights" TEXT[],
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignProduct" (
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "CampaignProduct_pkey" PRIMARY KEY ("campaignId","productId")
);

-- CreateTable
CREATE TABLE "ProductPhoto" (
    "productId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPhoto_pkey" PRIMARY KEY ("productId","assetId")
);

-- CreateTable
CREATE TABLE "CampaignPhoto" (
    "campaignId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignPhoto_pkey" PRIMARY KEY ("campaignId","assetId")
);

-- CreateIndex
CREATE INDEX "Product_businessId_status_createdAt_idx" ON "Product"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_businessId_status_createdAt_idx" ON "Campaign"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignProduct_productId_idx" ON "CampaignProduct"("productId");

-- CreateIndex
CREATE INDEX "ProductPhoto_assetId_idx" ON "ProductPhoto"("assetId");

-- CreateIndex
CREATE INDEX "CampaignPhoto_assetId_idx" ON "CampaignPhoto"("assetId");

-- CreateIndex
CREATE INDEX "GeneratedContent_productId_createdAt_idx" ON "GeneratedContent"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedContent_campaignId_createdAt_idx" ON "GeneratedContent"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedContent_businessId_createdAt_idx" ON "GeneratedContent"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSync_productId_key" ON "ProductSync"("productId");

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProduct" ADD CONSTRAINT "CampaignProduct_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProduct" ADD CONSTRAINT "CampaignProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPhoto" ADD CONSTRAINT "ProductPhoto_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPhoto" ADD CONSTRAINT "ProductPhoto_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPhoto" ADD CONSTRAINT "CampaignPhoto_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPhoto" ADD CONSTRAINT "CampaignPhoto_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSync" ADD CONSTRAINT "ProductSync_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---- BACKFILL (idempotent: safe to run again) ---------------------------------------------------------------------
-- Products: product and listing are physical things, service and project ("finished work you want to show") are
-- services. Listing and project keep their old type as the category.
INSERT INTO "Product" ("id", "businessId", "kind", "name", "category", "summary", "description", "priceModel", "priceAmount", "currency", "priceNote", "usps", "features", "targetCustomer", "status", "details", "createdAt", "updatedAt")
SELECT
  p."id",
  p."businessId",
  (CASE WHEN lower(btrim(p."type")) IN ('service', 'project') THEN 'SERVICE' ELSE 'PHYSICAL' END)::"ProductKind",
  left(btrim(p."title"), 200),
  CASE lower(btrim(p."type")) WHEN 'listing' THEN 'Listing' WHEN 'project' THEN 'Finished work' ELSE NULL END,
  left(btrim(regexp_replace(CASE WHEN coalesce(p."details"->>'notes', '') ~ '\S' THEN p."details"->>'notes' ELSE p."title" END, '\s+', ' ', 'g')), 300),
  CASE WHEN coalesce(p."details"->>'notes', '') ~ '\S' THEN p."details"->>'notes' ELSE NULL END,
  (CASE
    WHEN coalesce(p."price", '') !~ '[0-9]' THEN 'ON_REQUEST'
    WHEN p."price" ~* '^\s*from\s' THEN 'FROM'
    WHEN p."price" ~* '(^|[^a-z])(per|a|an)\s+month|/\s*month|monthly' THEN 'PER_MONTH'
    WHEN p."price" ~* '(^|[^a-z])(per|a|an)\s+year|/\s*year|yearly|annual' THEN 'PER_YEAR'
    ELSE 'FIXED'
  END)::"PriceModel",
  NULL,
  coalesce((SELECT r."currency" FROM "PricingRegion" r WHERE r."key" = b."pricingRegion"), CASE WHEN b."pricingRegion" = 'RW' THEN 'RWF' ELSE 'USD' END),
  CASE WHEN coalesce(p."price", '') ~ '\S' THEN btrim(p."price") ELSE NULL END,
  ARRAY[]::TEXT[],
  coalesce(p."features", ARRAY[]::TEXT[]),
  NULL,
  'ACTIVE'::"ItemStatus",
  NULL,
  p."createdAt",
  p."updatedAt"
FROM "Project" p
JOIN "Business" b ON b."id" = p."businessId"
WHERE lower(btrim(p."type")) IN ('product', 'listing', 'service', 'project')
  AND NOT EXISTS (SELECT 1 FROM "Product" x WHERE x."id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "Campaign" x WHERE x."id" = p."id");

-- Campaigns: event and offer keep their type; anything else (other, milestone, types sent through the API) is OTHER.
INSERT INTO "Campaign" ("id", "businessId", "type", "name", "description", "startsAt", "endsAt", "priceInfo", "highlights", "status", "createdAt", "updatedAt")
SELECT
  p."id",
  p."businessId",
  (CASE lower(btrim(p."type")) WHEN 'event' THEN 'EVENT' WHEN 'offer' THEN 'OFFER' ELSE 'OTHER' END)::"CampaignType",
  left(btrim(p."title"), 200),
  CASE WHEN coalesce(p."details"->>'notes', '') ~ '\S' THEN p."details"->>'notes' ELSE NULL END,
  NULL,
  NULL,
  CASE WHEN coalesce(p."price", '') ~ '\S' THEN btrim(p."price") ELSE NULL END,
  coalesce(p."features", ARRAY[]::TEXT[]),
  'ACTIVE'::"ItemStatus",
  p."createdAt",
  p."updatedAt"
FROM "Project" p
WHERE lower(btrim(p."type")) NOT IN ('product', 'listing', 'service', 'project')
  AND NOT EXISTS (SELECT 1 FROM "Product" x WHERE x."id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "Campaign" x WHERE x."id" = p."id");

-- Project photos become gallery photos (not in a folder) on their existing object paths, linked to the new album in
-- the same order. Ids are derived from the path, so running this again links the same rows. They are marked with
-- source 'project-migration' (lib/media/rules.ts MIGRATED_SOURCE): already stored before the quota knew about them,
-- they never count toward a company's 500 photos / 2 GB.
INSERT INTO "MediaAsset" ("id", "businessId", "folderId", "path", "name", "mimeType", "bytes", "source", "createdAt")
SELECT
  'mig_' || substr(md5(u."path"), 1, 24),
  p."businessId",
  NULL,
  u."path",
  left(btrim(p."title"), 100) || ' ' || u."ord",
  CASE lower(substring(u."path" from '\.([A-Za-z0-9]+)$')) WHEN 'png' THEN 'image/png' WHEN 'webp' THEN 'image/webp' ELSE 'image/jpeg' END,
  0,
  'project-migration',
  p."createdAt"
FROM "Project" p, unnest(p."photoPaths") WITH ORDINALITY AS u("path", "ord")
ON CONFLICT ("path") DO NOTHING;

INSERT INTO "ProductPhoto" ("productId", "assetId", "position", "createdAt")
SELECT p."id", a."id", (u."ord" - 1)::INTEGER, p."createdAt"
FROM "Project" p, unnest(p."photoPaths") WITH ORDINALITY AS u("path", "ord")
JOIN "MediaAsset" a ON a."path" = u."path"
WHERE EXISTS (SELECT 1 FROM "Product" x WHERE x."id" = p."id") AND a."businessId" = p."businessId"
ON CONFLICT DO NOTHING;

INSERT INTO "CampaignPhoto" ("campaignId", "assetId", "position", "createdAt")
SELECT p."id", a."id", (u."ord" - 1)::INTEGER, p."createdAt"
FROM "Project" p, unnest(p."photoPaths") WITH ORDINALITY AS u("path", "ord")
JOIN "MediaAsset" a ON a."path" = u."path"
WHERE EXISTS (SELECT 1 FROM "Campaign" x WHERE x."id" = p."id") AND a."businessId" = p."businessId"
ON CONFLICT DO NOTHING;

-- Sizes from Storage (shown, and counted toward the shared MEDIA_PLATFORM_MAX_BYTES, not the company quota); photos
-- whose file is gone are not kept as broken tiles. Without a readable storage schema the size stays 0 and the gallery
-- fills it on first read (lib/media/service.ts fillMigratedSizes).
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    UPDATE "MediaAsset" a SET "bytes" = coalesce((o."metadata"->>'size')::INTEGER, 0)
    FROM storage.objects o
    WHERE a."id" LIKE 'mig\_%' AND a."bytes" = 0 AND o."bucket_id" = 'media' AND o."name" = a."path";
    DELETE FROM "MediaAsset" a
    WHERE a."id" LIKE 'mig\_%' AND a."bytes" = 0
      AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o."bucket_id" = 'media' AND o."name" = a."path");
  END IF;
END $$;

-- Content, designs, posts and store mappings point at the product or campaign that has their project's id.
UPDATE "GeneratedContent" c SET "businessId" = p."businessId" FROM "Project" p WHERE p."id" = c."projectId" AND c."businessId" IS NULL;
UPDATE "GeneratedContent" c SET "productId" = c."projectId" WHERE c."productId" IS NULL AND c."campaignId" IS NULL AND EXISTS (SELECT 1 FROM "Product" x WHERE x."id" = c."projectId");
UPDATE "GeneratedContent" c SET "campaignId" = c."projectId" WHERE c."productId" IS NULL AND c."campaignId" IS NULL AND EXISTS (SELECT 1 FROM "Campaign" x WHERE x."id" = c."projectId");
UPDATE "Design" d SET "productId" = d."projectId" WHERE d."productId" IS NULL AND d."campaignId" IS NULL AND EXISTS (SELECT 1 FROM "Product" x WHERE x."id" = d."projectId");
UPDATE "Design" d SET "campaignId" = d."projectId" WHERE d."productId" IS NULL AND d."campaignId" IS NULL AND EXISTS (SELECT 1 FROM "Campaign" x WHERE x."id" = d."projectId");
UPDATE "Post" t SET "productId" = t."projectId" WHERE t."productId" IS NULL AND t."campaignId" IS NULL AND EXISTS (SELECT 1 FROM "Product" x WHERE x."id" = t."projectId");
UPDATE "Post" t SET "campaignId" = t."projectId" WHERE t."productId" IS NULL AND t."campaignId" IS NULL AND EXISTS (SELECT 1 FROM "Campaign" x WHERE x."id" = t."projectId");
UPDATE "ProductSync" s SET "productId" = s."projectId" WHERE s."productId" IS NULL AND EXISTS (SELECT 1 FROM "Product" x WHERE x."id" = s."projectId");
-- ---- END BACKFILL ---------------------------------------------------------------------------------------------------

-- Every content row had a project (projectId was NOT NULL with a cascading key), so every row now has its company.
ALTER TABLE "GeneratedContent" ALTER COLUMN "businessId" SET NOT NULL;

-- ---- Rows written by an older build (projectId only) --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bupulse_legacy_subject() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'GeneratedContent' AND NEW."businessId" IS NULL AND NEW."projectId" IS NOT NULL THEN
    NEW."businessId" := (SELECT p."businessId" FROM "Project" p WHERE p."id" = NEW."projectId");
  END IF;
  IF NEW."projectId" IS NOT NULL AND NEW."productId" IS NULL AND NEW."campaignId" IS NULL THEN
    IF EXISTS (SELECT 1 FROM "Product" x WHERE x."id" = NEW."projectId") THEN
      NEW."productId" := NEW."projectId";
    ELSIF EXISTS (SELECT 1 FROM "Campaign" x WHERE x."id" = NEW."projectId") THEN
      NEW."campaignId" := NEW."projectId";
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bupulse_legacy_subject() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER "GeneratedContent_legacy_subject" BEFORE INSERT ON "GeneratedContent" FOR EACH ROW EXECUTE FUNCTION public.bupulse_legacy_subject();
CREATE TRIGGER "Design_legacy_subject" BEFORE INSERT ON "Design" FOR EACH ROW EXECUTE FUNCTION public.bupulse_legacy_subject();
CREATE TRIGGER "Post_legacy_subject" BEFORE INSERT ON "Post" FOR EACH ROW EXECUTE FUNCTION public.bupulse_legacy_subject();

-- ---- Same rules as every other table: RLS on, no access through the Data API (Prisma connects as postgres) ----------
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignPhoto" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Product", "Campaign", "CampaignProduct", "ProductPhoto", "CampaignPhoto" FROM PUBLIC, anon, authenticated, service_role;
