-- "Get a free quote" (lib/quote): quote requests are ContactRequest rows of kind "quote". They record where the person
-- came from (/quote?src=instagram, or "website" for the pop-up) and the page the form was sent from, and their note is
-- optional, so "message" may now be empty. Additive: every row already saved keeps its message and gets no source.
ALTER TABLE "ContactRequest" ALTER COLUMN "message" DROP NOT NULL;
ALTER TABLE "ContactRequest" ADD COLUMN "source" TEXT;
ALTER TABLE "ContactRequest" ADD COLUMN "pageUrl" TEXT;
