-- Posts for apps that are not connected yet (docs/CONTENT.md): drafted like the others and, once approved, sent as a
-- "post it yourself" reminder. Columns only: Post and GeneratedContent keep their RLS and revoked grants.
ALTER TABLE "Post" ADD COLUMN "remindOnly" BOOLEAN NOT NULL DEFAULT false;

-- Content drafted into posts; content from before stays null and is drafted once (the backfill), never again after
-- the owner rejected its drafts.
ALTER TABLE "GeneratedContent" ADD COLUMN "postsDraftedAt" TIMESTAMP(3);
