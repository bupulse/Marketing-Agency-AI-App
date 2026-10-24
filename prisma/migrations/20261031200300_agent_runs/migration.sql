-- The agent team's own run log (docs/TRAINING_LAB.md, "The agent team inside BuPulse"): one row per attempt of a team
-- member, for the Team page. Locked like every other table (row level security on, no Data API grants).

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "brain" TEXT NOT NULL,
    "model" TEXT,
    "feature" TEXT NOT NULL,
    "businessId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "exampleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resultRef" TEXT,
    "rating" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentRun_brain_check" CHECK ("brain" IN ('gemini', 'anthropic', 'claude-subscription', 'rules')),
    CONSTRAINT "AgentRun_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE INDEX "AgentRun_agentId_createdAt_idx" ON "AgentRun"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_resultRef_idx" ON "AgentRun"("resultRef");

-- The app reaches this table through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "AgentRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AgentRun" FROM PUBLIC, anon, authenticated, service_role;
