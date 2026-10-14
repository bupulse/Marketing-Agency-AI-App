-- Custom plan offers and added features can be paid by card (lib/offers/card.ts, docs/OFFERS.md "Card"): the offer's
-- payMethod may now be 'card'. Constraint change only: PlanOffer keeps its RLS and grants.
ALTER TABLE "PlanOffer" DROP CONSTRAINT "PlanOffer_pay_method_check";
ALTER TABLE "PlanOffer" ADD CONSTRAINT "PlanOffer_pay_method_check" CHECK ("payMethod" IS NULL OR "payMethod" IN ('momo', 'invoice', 'card'));
