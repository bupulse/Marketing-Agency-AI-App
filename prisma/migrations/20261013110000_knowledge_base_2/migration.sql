-- Knowledge base, part 2 (docs/KNOWLEDGE_BASE.md): customers and audience (personas), competitors and positioning,
-- FAQs and policies, reviews and testimonials, and the AI marketing interview.
--
-- FAQs move from Business.knowledge.faqs (JSON, at most 10) to their own table, in order. The JSON list is copied
-- below and left in place, unread from this build on, so an older build still finds it. Nothing is dropped.

-- CreateEnum
CREATE TYPE "ReviewSource" AS ENUM ('GOOGLE', 'WHATSAPP', 'IN_PERSON', 'FACEBOOK', 'INSTAGRAM', 'EMAIL', 'OTHER');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "audienceNotes" TEXT,
ADD COLUMN     "marketingProfile" JSONB,
ADD COLUMN     "policies" JSONB,
ADD COLUMN     "positioning" JSONB;

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ageRange" TEXT NOT NULL,
    "gender" TEXT,
    "location" TEXT NOT NULL,
    "occupation" TEXT,
    "incomeBand" TEXT,
    "needs" TEXT[],
    "pains" TEXT[],
    "objections" TEXT[],
    "channels" TEXT[],
    "triggers" TEXT[],
    "language" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "link" TEXT,
    "strengths" TEXT[],
    "weaknesses" TEXT[],
    "pricePosition" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeFaq" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeFaq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "source" "ReviewSource" NOT NULL,
    "rating" INTEGER,
    "receivedOn" DATE,
    "productId" TEXT,
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingInterview" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mode" TEXT NOT NULL DEFAULT 'ai',
    "steps" JSONB NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "aiCalls" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingInterview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Persona_businessId_position_idx" ON "Persona"("businessId", "position");

-- CreateIndex
CREATE INDEX "Competitor_businessId_position_idx" ON "Competitor"("businessId", "position");

-- CreateIndex
CREATE INDEX "KnowledgeFaq_businessId_position_idx" ON "KnowledgeFaq"("businessId", "position");

-- CreateIndex
CREATE INDEX "Testimonial_businessId_createdAt_idx" ON "Testimonial"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Testimonial_productId_idx" ON "Testimonial"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingInterview_businessId_key" ON "MarketingInterview"("businessId");

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFaq" ADD CONSTRAINT "KnowledgeFaq_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInterview" ADD CONSTRAINT "MarketingInterview_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---- FAQs: copy Business.knowledge.faqs (the business info card's list) into KnowledgeFaq, keeping the order ----------
-- Idempotent: a business that already has FAQ rows is skipped. Blank questions or answers are left out, as
-- readKnowledge() did.
INSERT INTO "KnowledgeFaq" ("id", "businessId", "question", "answer", "position", "createdAt", "updatedAt")
SELECT 'mig_' || md5(b."id" || ':' || f.ord::text), b."id", left(btrim(f.item->>'question'), 200), left(btrim(f.item->>'answer'), 1000), (f.ord - 1)::int, NOW(), NOW()
FROM "Business" b
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(b."knowledge"->'faqs') = 'array' THEN b."knowledge"->'faqs' ELSE '[]'::jsonb END
) WITH ORDINALITY AS f(item, ord)
WHERE jsonb_typeof(f.item) = 'object'
  AND btrim(coalesce(f.item->>'question', '')) <> ''
  AND btrim(coalesce(f.item->>'answer', '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM "KnowledgeFaq" k WHERE k."businessId" = b."id")
ON CONFLICT ("id") DO NOTHING;

-- ---- Same rules as every other table: RLS on, no access through the Data API (Prisma connects as postgres) ----------
ALTER TABLE "Persona" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Competitor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeFaq" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Testimonial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingInterview" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Persona", "Competitor", "KnowledgeFaq", "Testimonial", "MarketingInterview" FROM PUBLIC, anon, authenticated, service_role;
