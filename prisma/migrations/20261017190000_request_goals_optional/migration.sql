-- The custom plan request form no longer asks "What do you want to achieve?" (docs/OFFERS.md): new requests have no
-- goals. Older requests keep theirs. Column change only: CustomPlanRequest keeps its RLS and grants.
ALTER TABLE "CustomPlanRequest" ALTER COLUMN "goals" DROP NOT NULL;
