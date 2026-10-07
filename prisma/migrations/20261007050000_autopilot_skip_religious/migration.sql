-- Autopilot: let the owner skip religious holidays when planning posts.
ALTER TABLE "AutopilotSettings" ADD COLUMN "skipReligiousHolidays" BOOLEAN NOT NULL DEFAULT false;
