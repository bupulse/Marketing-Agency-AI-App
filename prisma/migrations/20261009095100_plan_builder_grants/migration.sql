-- The plan builder tables follow the same grant rules as the other admin tables: RLS on, and no access for anon,
-- authenticated or service_role (Prisma connects as postgres).
REVOKE ALL ON TABLE "PlanDefinition", "PlanPriceChange", "PlanPriceChangeItem" FROM PUBLIC, anon, authenticated, service_role;
