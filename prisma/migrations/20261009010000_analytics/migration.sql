-- Phase 8: first-party analytics, product events, daily roll-ups and owner-entered monthly costs.
CREATE TABLE "PageView" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sessionId" TEXT,
  "visitorHash" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "referrerHost" TEXT,
  "source" TEXT NOT NULL,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "device" TEXT NOT NULL,
  "country" TEXT,
  "screenWidth" INTEGER,
  CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PageView_createdAt_idx" ON "PageView"("createdAt");
CREATE INDEX "PageView_sessionId_idx" ON "PageView"("sessionId");

CREATE TABLE "AnalyticsEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "name" TEXT NOT NULL,
  "userId" UUID,
  "businessId" TEXT,
  "sessionId" TEXT,
  "props" JSONB,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsEvent_name_createdAt_idx" ON "AnalyticsEvent"("name", "createdAt");
CREATE INDEX "AnalyticsEvent_userId_createdAt_idx" ON "AnalyticsEvent"("userId", "createdAt");
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

CREATE TABLE "DailyMetric" (
  "date" DATE NOT NULL,
  "key" TEXT NOT NULL,
  "dimension" TEXT NOT NULL DEFAULT '',
  "value" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyMetric_pkey" PRIMARY KEY ("date", "key", "dimension")
);
CREATE INDEX "DailyMetric_key_date_idx" ON "DailyMetric"("key", "date");

CREATE TABLE "MonthlyCost" (
  "id" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "note" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonthlyCost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MonthlyCost_month_category_key" ON "MonthlyCost"("month", "category");

-- Server-only tables: no policies, so the public API roles can read nothing.
ALTER TABLE "PageView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyMetric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyCost" ENABLE ROW LEVEL SECURITY;
