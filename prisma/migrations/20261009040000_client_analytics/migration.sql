-- Client Analytics: range queries per business over published posts and chat sessions.
CREATE INDEX IF NOT EXISTS "Post_businessId_status_publishedAt_idx" ON "Post"("businessId", "status", "publishedAt");
CREATE INDEX IF NOT EXISTS "ChatSession_businessId_createdAt_idx" ON "ChatSession"("businessId", "createdAt");
