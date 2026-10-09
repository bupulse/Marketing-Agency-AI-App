-- Admin console: system health (cron run log) and private admin notes about a client.

CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "summary" TEXT,
    "error" TEXT,
    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CronRun_job_startedAt_idx" ON "CronRun"("job", "startedAt");
CREATE INDEX "CronRun_startedAt_idx" ON "CronRun"("startedAt");

-- A private note the owner writes about a client. No foreign key: account deletion removes the notes explicitly
-- (and the audit trail of them is redacted with the rest of the user's audit rows).
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminNote_userId_createdAt_idx" ON "AdminNote"("userId", "createdAt");

ALTER TABLE "CronRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminNote" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CronRun", "AdminNote" FROM PUBLIC, anon, authenticated;
