// Importing this file registers every DueJob handler of this build (each module calls registerJobHandler()).
// The cron that runs the jobs (app/api/cron/publish) imports it. Add one import per module with job handlers here.
import "@/lib/automations/jobs";
