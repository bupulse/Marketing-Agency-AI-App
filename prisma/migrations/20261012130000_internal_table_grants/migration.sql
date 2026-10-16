-- Phase 9 security review (C1, L5). The Phase 7 tables for outgoing webhooks and REST API keys were created without
-- RLS, so Supabase's Data API (/rest/v1, publishable key) could read and write them, including webhook signing
-- secrets and API key hashes. Same rules as the other internal tables: RLS on with no policies, and no grants for
-- anon, authenticated or service_role. Prisma connects as postgres (the owner), which RLS and these grants do not affect.
ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WebhookEndpoint", "WebhookDelivery", "ApiKey" FROM PUBLIC, anon, authenticated, service_role;

-- Prisma's own bookkeeping table sits in public too and had the default grants and no RLS.
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "_prisma_migrations" FROM PUBLIC, anon, authenticated, service_role;

-- The older internal tables had RLS on (no policies, so no rows) but kept Supabase's default table grants. RLS alone
-- already hides their rows; revoking the grants as well means a policy added by mistake later cannot open them.
-- No table in public is read by the browser or through the Data API (the app reaches them only through Prisma), and
-- Storage (storage schema) and the policy helper functions (SECURITY DEFINER, owned by postgres) need no table grants.
-- tests/security/rls-coverage.test.ts fails when a model's table is missing from an ENABLE ROW LEVEL SECURITY and a
-- REVOKE like these.
REVOKE ALL ON TABLE
  "User", "Business", "Project", "GeneratedContent", "Lead", "ChatWidget", "ChatSession", "ChatMessage", "Subscription",
  "BillingEvent", "ManualPayment", "RenewalNotice", "UsageRecord", "Connection", "Post", "PostMetrics", "ErrorLog",
  "ContactRequest", "Design", "AiCall", "RateLimit", "CanvaConnection", "CanvaEdit", "MediaFolder", "MediaAsset",
  "AutopilotSettings", "AutopilotRun", "StoreConnection", "ProductSync", "CloudflareConnection", "CloudflareInstall",
  "StoreConnectionPending", "PageView", "AnalyticsEvent", "DailyMetric", "MonthlyCost", "AuditLog", "AdminApproval",
  "AdminApiKey", "FeatureFlag", "Announcement", "AnalyticsSalt", "CronRun", "AdminNote", "ServiceSwitch", "ServiceCheck",
  "ServiceUsage", "AdminSetting", "PlanDefinition", "PricingRegion", "PlanRegionPrice", "AdminAvailability", "DemoBooking",
  "PlanPriceChange", "PlanPriceChangeItem", "Membership", "Invite", "Industry", "DismissedIndustrySuggestion"
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;

-- New tables and sequences created by the migration role get no API grants either (functions were closed the same
-- way in 20261009062000_function_default_privileges). A new model still needs its own ENABLE ROW LEVEL SECURITY.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
