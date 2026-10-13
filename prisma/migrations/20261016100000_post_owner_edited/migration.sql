-- Posts the owner changed by hand (docs/CONTENT.md): a Studio rewrite replaces only untouched drafts, and a finished
-- picture or video is never put on a post the owner edited. Column only: Post keeps its RLS and revoked grants.
ALTER TABLE "Post" ADD COLUMN "ownerEditedAt" TIMESTAMP(3);
