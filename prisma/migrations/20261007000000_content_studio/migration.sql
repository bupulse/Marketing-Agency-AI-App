-- Phase 4: content studio, branded designs, AI cost ledger, content language.
ALTER TABLE "Business" ADD COLUMN "contentLanguage" TEXT NOT NULL DEFAULT 'English';

ALTER TABLE "Project" RENAME COLUMN "photoUrls" TO "photoPaths";
CREATE INDEX "Project_businessId_createdAt_idx" ON "Project"("businessId", "createdAt");

ALTER TABLE "GeneratedContent" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'English';
ALTER TABLE "GeneratedContent" ADD COLUMN "variants" JSONB;
ALTER TABLE "GeneratedContent" ADD COLUMN "edited" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "DesignKind" AS ENUM ('TEMPLATE', 'AI');

CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" "DesignKind" NOT NULL,
    "template" TEXT,
    "prompt" TEXT,
    "aspectRatio" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Design_businessId_createdAt_idx" ON "Design"("businessId", "createdAt");
ALTER TABLE "Design" ADD CONSTRAINT "Design_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Design" ADD CONSTRAINT "Design_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Design" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "userId" UUID,
    "businessId" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiCall_createdAt_idx" ON "AiCall"("createdAt");
CREATE INDEX "AiCall_businessId_createdAt_idx" ON "AiCall"("businessId", "createdAt");
ALTER TABLE "AiCall" ENABLE ROW LEVEL SECURITY;
