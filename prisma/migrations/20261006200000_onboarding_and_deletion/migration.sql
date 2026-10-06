-- Phase 2: brand onboarding and account deletion with a 30-day grace period.
ALTER TABLE "Business" ADD COLUMN "audience" TEXT;
ALTER TABLE "Business" ADD COLUMN "onboardedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletionScheduledFor" TIMESTAMP(3);
