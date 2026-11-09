-- Server monitoring for the support dashboard (docs/SUPPORT_DASHBOARD.md, "Server monitoring"; lib/monitor). New
-- tables only. Locked like every other table (row level security on, no Data API grants).

-- The server PC's report every minute (scripts/self-host/windows/cron-loop.ps1), kept 30 days.
-- CreateTable
CREATE TABLE "MonitorHeartbeat" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "machine" TEXT NOT NULL,
    "os" TEXT,
    "bootAt" TIMESTAMP(3),
    "cpuPercent" INTEGER,
    "memUsedMb" INTEGER,
    "memTotalMb" INTEGER,
    "disks" JSONB NOT NULL DEFAULT '[]',
    "tasks" JSONB NOT NULL DEFAULT '[]',
    "serverListening" BOOLEAN,
    "nodeVersion" TEXT,
    "cloudflaredVersion" TEXT,

    CONSTRAINT "MonitorHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitorHeartbeat_receivedAt_idx" ON "MonitorHeartbeat"("receivedAt");

-- The outside checks from GitHub Actions (.github/workflows/uptime.yml), kept 35 days.
-- CreateTable
CREATE TABLE "UptimeCheck" (
    "id" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "statusMs" INTEGER,
    "databaseMs" INTEGER,
    "version" TEXT,
    "pages" JSONB NOT NULL DEFAULT '[]',
    "retried" BOOLEAN NOT NULL DEFAULT false,
    "afterFailure" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UptimeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UptimeCheck_checkedAt_idx" ON "UptimeCheck"("checkedAt");

-- CreateIndex
CREATE INDEX "UptimeCheck_ok_checkedAt_idx" ON "UptimeCheck"("ok", "checkedAt");

-- Outages found from the checks; the unique start makes the "back up" alert go out once per outage.
-- CreateTable
CREATE TABLE "UptimeIncident" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "alertedAt" TIMESTAMP(3),
    "alerts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UptimeIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UptimeIncident_startedAt_key" ON "UptimeIncident"("startedAt");

-- CreateIndex
CREATE INDEX "UptimeIncident_endedAt_idx" ON "UptimeIncident"("endedAt");

-- The app reaches these tables through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "MonitorHeartbeat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UptimeCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UptimeIncident" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MonitorHeartbeat", "UptimeCheck", "UptimeIncident" FROM PUBLIC, anon, authenticated, service_role;
