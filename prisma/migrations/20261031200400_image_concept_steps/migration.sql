-- A picture is made in steps of one AI call each (lib/image-engine/engine.ts WORKING_STATUSES), so no call runs past
-- Netlify's 60 s: the Painter ("painting" to "painted"), the Checker ("painted", then done or "fixing"), the Editor's
-- one fix ("fixing" to "edited") and the Checker on the fix ("edited" to done). Additive: the check allows the three
-- new steps; every row already saved still passes it.
ALTER TABLE "ImageConcept" DROP CONSTRAINT "ImageConcept_status_check";
ALTER TABLE "ImageConcept" ADD CONSTRAINT "ImageConcept_status_check" CHECK ("status" IN ('planned', 'painting', 'painted', 'fixing', 'edited', 'done', 'failed'));
