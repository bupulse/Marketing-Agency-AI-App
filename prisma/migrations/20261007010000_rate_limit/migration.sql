-- Simple per-user rate limits for free-but-costly actions (template designs, uploads, previews...).
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key", "windowStart")
);
CREATE INDEX "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");
ALTER TABLE "RateLimit" ENABLE ROW LEVEL SECURITY;
