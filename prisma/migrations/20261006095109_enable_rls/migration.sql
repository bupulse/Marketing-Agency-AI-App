-- Supabase exposes the public schema through its Data API using the publishable key.
-- BuPulse only accesses these tables from the server (Prisma, as the postgres role,
-- which bypasses RLS), so enable RLS with no policies: the public API gets no access.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Business" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GeneratedContent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SocialAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PostMetrics" ENABLE ROW LEVEL SECURITY;
