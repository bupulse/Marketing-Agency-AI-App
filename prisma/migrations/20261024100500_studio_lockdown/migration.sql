-- The app reaches the Video Studio's tables through Prisma only; the Data API roles get nothing (like every table,
-- tests/security/rls-coverage.test.ts). VideoJob and VideoOutcome had row level security but kept their grants.
ALTER TABLE "StudioTicket" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "StudioTicket", "VideoJob", "VideoOutcome" FROM PUBLIC, anon, authenticated, service_role;
