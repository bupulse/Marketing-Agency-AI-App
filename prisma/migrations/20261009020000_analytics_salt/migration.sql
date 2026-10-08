-- Random per-day key for the analytics visitor hash; rows are deleted when the day has ended.
CREATE TABLE "AnalyticsSalt" (
  "day" TEXT NOT NULL,
  "salt" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsSalt_pkey" PRIMARY KEY ("day")
);
ALTER TABLE "AnalyticsSalt" ENABLE ROW LEVEL SECURITY;
