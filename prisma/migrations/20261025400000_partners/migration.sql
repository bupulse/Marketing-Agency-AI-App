-- Partner programme (docs/bizdev/PLAN.md section 6, docs/guide/features/25-partners.md): outside partners,
-- the companies they referred and the commission paid to them. Only new tables: nothing existing is changed. New tables
-- are locked like every other (row level security on, no Data API grants).

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organisation" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT,
    "message" TEXT,
    "refCode" TEXT,
    "viewToken" TEXT,
    "rejectReason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Partner_status_check" CHECK ("status" IN ('applied', 'approved', 'rejected', 'paused'))
);

-- CreateTable
CREATE TABLE "PartnerReferral" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPayout" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPayout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PartnerPayout_amount_check" CHECK ("amountMinor" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_refCode_key" ON "Partner"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_viewToken_key" ON "Partner"("viewToken");

-- CreateIndex
CREATE INDEX "Partner_status_idx" ON "Partner"("status");

-- CreateIndex
CREATE INDEX "Partner_email_idx" ON "Partner"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerReferral_businessId_key" ON "PartnerReferral"("businessId");

-- CreateIndex
CREATE INDEX "PartnerReferral_partnerId_idx" ON "PartnerReferral"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerReferral_userId_idx" ON "PartnerReferral"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPayout_reference_key" ON "PartnerPayout"("reference");

-- CreateIndex
CREATE INDEX "PartnerPayout_partnerId_paidAt_idx" ON "PartnerPayout"("partnerId", "paidAt");

-- AddForeignKey
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPayout" ADD CONSTRAINT "PartnerPayout_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The app reaches these tables through Prisma only; the Data API roles get nothing (like every table,
-- tests/security/rls-coverage.test.ts).
ALTER TABLE "Partner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartnerReferral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartnerPayout" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Partner", "PartnerReferral", "PartnerPayout" FROM PUBLIC, anon, authenticated, service_role;
