-- New sign-ups no longer start a trial: they choose a plan, book a demo and wait for an admin to start the trial
-- (docs/REGIONS.md). The new enum value is added on its own: Postgres refuses to use a value in the transaction that
-- created it, so the columns and seeds that use it live in the next migration (20261010100100_regions_and_demos).
-- Existing subscriptions are not touched: TRIALING, ACTIVE, PAST_DUE, CANCELED and EXPIRED keep their meaning.
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PENDING_DEMO';
