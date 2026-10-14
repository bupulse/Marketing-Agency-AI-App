-- Post versions (docs/CONTENT.md, "Versions"): a post's words at each change (its first text, every edit, every
-- "Generate again" and every restore), so the owner can look back and restore one. Restoring adds a new version; none
-- is overwritten. Scoped by business. Server only: RLS on, no grants. Additive.
CREATE TABLE "PostVersion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "part" TEXT,
    "restoredFromId" TEXT,
    "actorId" UUID,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "hashtags" TEXT[],
    "videoScript" TEXT NOT NULL DEFAULT '',
    "adHeadlines" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PostVersion_kind_check" CHECK ("kind" IN ('original', 'edit', 'regenerate', 'restore')),
    CONSTRAINT "PostVersion_part_check" CHECK ("part" IS NULL OR "part" IN ('post', 'caption', 'script', 'headlines'))
);
CREATE INDEX "PostVersion_postId_createdAt_idx" ON "PostVersion"("postId", "createdAt");
CREATE INDEX "PostVersion_businessId_createdAt_idx" ON "PostVersion"("businessId", "createdAt");
ALTER TABLE "PostVersion" ADD CONSTRAINT "PostVersion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostVersion" ADD CONSTRAINT "PostVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostVersion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PostVersion" FROM PUBLIC, anon, authenticated, service_role;
