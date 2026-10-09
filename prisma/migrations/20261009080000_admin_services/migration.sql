-- Admin console: per-service kill switches, last health-check results, small usage counters and admin settings.

CREATE TABLE "ServiceSwitch" (
    "service" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "changedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceSwitch_pkey" PRIMARY KEY ("service")
);

CREATE TABLE "ServiceCheck" (
    "service" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "message" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceCheck_pkey" PRIMARY KEY ("service")
);

CREATE TABLE "ServiceUsage" (
    "service" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "ok" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ServiceUsage_pkey" PRIMARY KEY ("service", "day")
);

CREATE TABLE "AdminSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("key")
);

-- Server-only tables: RLS on with no policies, and no access for the API roles.
ALTER TABLE "ServiceSwitch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminSetting" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ServiceSwitch", "ServiceCheck", "ServiceUsage", "AdminSetting" FROM anon, authenticated, service_role;
