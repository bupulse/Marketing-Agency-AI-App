-- Link in bio (docs/guide/features/33-link-in-bio.md): each company's public page at /b/<slug>, the products on it
-- and its daily visits and taps. Real testimonials on the marketing site (docs/guide/features/34-testimonials.md),
-- added in Admin. Only new tables: nothing existing is changed. Every page starts switched off, and a testimonial
-- cannot be published without the client's consent (a CHECK). Locked like every other table (row level security on,
-- no Data API grants).

-- CreateTable
CREATE TABLE "BioPage" (
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT NOT NULL,
    "tagline" TEXT,
    "whatsapp" TEXT,
    "message" TEXT,
    "phone" TEXT,
    "location" TEXT,
    "landmark" TEXT,
    "showHours" BOOLEAN NOT NULL DEFAULT true,
    "links" TEXT[],
    "logoPath" TEXT,
    "logoSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BioPage_pkey" PRIMARY KEY ("businessId"),
    CONSTRAINT "BioPage_slug_check" CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$')
);

-- CreateTable
CREATE TABLE "BioPageItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "photoPath" TEXT,
    "photoSource" TEXT,

    CONSTRAINT "BioPageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioPageDay" (
    "businessId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "whatsapp" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BioPageDay_pkey" PRIMARY KEY ("businessId","date"),
    CONSTRAINT "BioPageDay_counts_check" CHECK ("views" >= 0 AND "whatsapp" >= 0 AND "calls" >= 0)
);

-- CreateTable
CREATE TABLE "SiteTestimonial" (
    "id" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "business" TEXT NOT NULL,
    "sector" TEXT,
    "quote" TEXT NOT NULL,
    "result" TEXT,
    "photo" BYTEA,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteTestimonial_pkey" PRIMARY KEY ("id"),
    -- Never on the site without the client's consent, whatever the app does.
    CONSTRAINT "SiteTestimonial_consent_check" CHECK (NOT "published" OR "consent")
);

-- CreateIndex
CREATE UNIQUE INDEX "BioPage_slug_key" ON "BioPage"("slug");

-- CreateIndex
CREATE INDEX "BioPageItem_productId_idx" ON "BioPageItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "BioPageItem_businessId_productId_key" ON "BioPageItem"("businessId", "productId");

-- CreateIndex
CREATE INDEX "SiteTestimonial_published_position_idx" ON "SiteTestimonial"("published", "position");

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPageItem" ADD CONSTRAINT "BioPageItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "BioPage"("businessId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPageItem" ADD CONSTRAINT "BioPageItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPageDay" ADD CONSTRAINT "BioPageDay_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "BioPage"("businessId") ON DELETE CASCADE ON UPDATE CASCADE;

-- The app reaches these tables through Prisma only; the Data API roles get nothing (like every table,
-- tests/security/rls-coverage.test.ts).
ALTER TABLE "BioPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BioPageItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BioPageDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteTestimonial" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "BioPage", "BioPageItem", "BioPageDay", "SiteTestimonial" FROM PUBLIC, anon, authenticated, service_role;
