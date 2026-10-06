-- Google sign-ups skip the sign-up form, so they must fill in their organisation
-- details on /welcome before using the dashboard. This marks who has done that.
ALTER TABLE "Business" ADD COLUMN "detailsCompletedAt" TIMESTAMP(3);

UPDATE "Business" SET "detailsCompletedAt" = "createdAt"
WHERE "ceoName" IS NOT NULL AND "industry" IS NOT NULL AND "country" IS NOT NULL;
