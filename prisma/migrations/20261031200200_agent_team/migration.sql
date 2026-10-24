-- The agent team's brain choices (docs/TRAINING_LAB.md, "The agent team inside BuPulse"): one row per team member the
-- owner has switched away from its default brain. Locked like every other table (row level security on, no Data API
-- grants).

-- CreateTable
CREATE TABLE "AgentSetting" (
    "agentId" TEXT NOT NULL,
    "brain" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSetting_pkey" PRIMARY KEY ("agentId"),
    CONSTRAINT "AgentSetting_brain_check" CHECK ("brain" IN ('gemini', 'anthropic', 'claude-subscription', 'rules'))
);

-- The app reaches this table through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "AgentSetting" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AgentSetting" FROM PUBLIC, anon, authenticated, service_role;
