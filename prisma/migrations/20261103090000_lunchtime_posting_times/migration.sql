-- Owner, 3 November 2026: posts go out best between 11:30 AM and 1:30 PM local, so the default posting times are every
-- half hour in that window. Businesses still on the old default (09:00 and 18:00) move to the new one; times a business
-- chose itself are kept.
ALTER TABLE "AutopilotSettings" ALTER COLUMN "postingTimes" SET DEFAULT ARRAY['11:30', '12:00', '12:30', '13:00', '13:30']::TEXT[];

UPDATE "AutopilotSettings" SET "postingTimes" = ARRAY['11:30', '12:00', '12:30', '13:00', '13:30']::TEXT[]
WHERE "postingTimes" = ARRAY['09:00', '18:00']::TEXT[];
