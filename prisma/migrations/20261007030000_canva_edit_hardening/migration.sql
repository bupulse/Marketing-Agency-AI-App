-- Canva returns are claimed atomically (processingAt), and an edit session disappears with its user.
ALTER TABLE "CanvaEdit" ADD COLUMN "processingAt" TIMESTAMP(3);
DELETE FROM "CanvaEdit" WHERE "userId" NOT IN (SELECT "id" FROM "User");
ALTER TABLE "CanvaEdit" ADD CONSTRAINT "CanvaEdit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
