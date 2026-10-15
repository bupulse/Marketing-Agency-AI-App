-- A feature removed from a card plan (lib/offers/card-plan.ts, docs/OFFERS.md "Removing a feature from a card plan") is
-- recorded as a PlanOffer with options.mode 'removal' and nothing to pay: only such a row may have adjustedMinor 0; every
-- other offer still costs more than zero. Constraint change only: PlanOffer keeps its RLS and grants.
ALTER TABLE "PlanOffer" DROP CONSTRAINT "PlanOffer_amounts_check";
ALTER TABLE "PlanOffer" ADD CONSTRAINT "PlanOffer_amounts_check" CHECK ("computedMinor" >= 0 AND ("adjustedMinor" > 0 OR ("adjustedMinor" = 0 AND "options"->>'mode' = 'removal')));
