-- Gallery imports (Google Drive, Dropbox, Canva): remember where a photo came from.
ALTER TABLE "MediaAsset" ADD COLUMN "source" TEXT;
