-- Contest posts (docs/CONTENT.md): a challenge or contest the AI suggested waits for the owner's prize, end date and
-- winner rule. Column only: Post keeps its RLS and revoked grants.
ALTER TABLE "Post" ADD COLUMN "contest" JSONB;
