import "server-only";
import { z } from "zod";
import * as analytics from "@/lib/analytics/queries";
import { METRIC_KEYS, type DateRange, type MetricKey } from "@/lib/analytics/types";
import * as admin from "./service";
import * as companies from "./actions/companies";
import * as services from "./services";
import * as aiUsage from "./ai-usage";
import * as connections from "./connections";
import * as connectionActions from "./actions/connections";
import * as clientView from "./client360";
import { getActivity } from "./activity";
import { getSystemHealth } from "./health";
import { SERVICE_IDS } from "./service-catalog";
import { AdminError, type AdminContext } from "./types";

// One registry of every tool Jarvis can use. The REST API (/api/admin/v1) and the MCP server (/api/mcp) both call
// callTool(), so validation, confirm / idempotency rules and audit logging are identical on both.

export type ToolKind = "read" | "action" | "money";
export type Tool = {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  schema: z.ZodObject;
  run: (args: never, ctx: AdminContext) => Promise<unknown>;
};

// A plan key (see list_plans): TRIAL, STANDARD, PRO or any plan created in /admin/plans.
const PLAN = z.string().min(1).max(64);
const id = (what: string) => z.string().min(1).max(100).describe(what);
const cursor = z.string().max(100).optional().describe("Pass nextCursor from the previous page to get the next page.");
const limit = z.number().int().min(1).max(100).optional().describe("Page size, 1-100 (default 25).");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const RANGE = {
  from: day.optional().describe("First day, YYYY-MM-DD (UTC, inclusive). Use with `to`."),
  to: day.optional().describe("Last day, YYYY-MM-DD (UTC, inclusive). Defaults to today."),
  days: z.number().int().min(1).max(366).optional().describe("Alternative to from/to: the last N days up to today. Default 7."),
};

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** A DateRange from from/to, or from `days` (default 7) ending today (UTC). */
export function resolveRange(a: { from?: string; to?: string; days?: number }, now = new Date()): DateRange {
  const to = a.to ?? ymd(now);
  const from = a.from ?? ymd(new Date(Date.parse(`${to}T00:00:00Z`) - ((a.days ?? 7) - 1) * 86_400_000));
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new AdminError("invalid", "from/to must be real dates (YYYY-MM-DD).");
  if (from > to) throw new AdminError("invalid", "from must not be after to.");
  return { from, to };
}

const rangeSchema = z.object(RANGE);
type RangeArgs = z.infer<typeof rangeSchema>;

const MONEY_NOTE =
  "MONEY ACTION: this does NOT move money. It only creates an approval request (status pending) and returns its id. The owner must click Approve in the BuPulse admin console before anything runs; it then runs exactly once. Poll get_approval(id) for the outcome (executed, failed, or needs_check = the owner must verify in Paddle). ";

const defs: Tool[] = [];
function tool<S extends z.ZodObject>(t: { name: string; title: string; kind: ToolKind; description: string; schema: S; run: (a: z.infer<S>, ctx: AdminContext) => Promise<unknown> }) {
  defs.push(t as unknown as Tool);
}

// ---- analytics (read) --------------------------------------------------------------------------------------

const analyticsTool = (name: string, title: string, description: string, fn: (r: DateRange) => Promise<unknown>) =>
  tool({ name, title, kind: "read", description, schema: rangeSchema, run: (a: RangeArgs) => fn(resolveRange(a)) });

analyticsTool("get_overview", "Business overview", "Headline numbers for a period: visits, sign-ups, trials, paying customers, MRR, revenue, costs and profit, with the change against the previous period. Default: last 7 days.", analytics.getOverview);

tool({
  name: "get_metrics",
  title: "Daily metrics",
  kind: "read",
  description: `Daily time series of named metrics for a period. keys defaults to visits, signups, paid_starts, mrr_cents and revenue_cents. Available keys: ${METRIC_KEYS.join(", ")}. Money is USD cents.`,
  schema: z.object({ ...RANGE, keys: z.array(z.enum(METRIC_KEYS)).min(1).max(25).optional().describe("Metric keys to return.") }),
  run: (a) => analytics.getMetrics(resolveRange(a), (a.keys ?? ["visits", "signups", "paid_starts", "mrr_cents", "revenue_cents"]) as MetricKey[]),
});

analyticsTool("get_funnel", "Conversion funnel", "The sign-up funnel for a period: visit -> sign-up -> onboarding -> first content -> trial -> paid, with the drop-off at each step.", analytics.getFunnel);
analyticsTool("get_revenue", "Revenue", "Revenue for a period from Paddle: MRR, new, churned, refunds, plan mix, by day. USD cents.", analytics.getRevenue);
analyticsTool("get_costs", "Costs", "Costs for a period: AI (from the AI call ledger), email, hosting and other monthly costs the owner entered. USD cents.", analytics.getCosts);
analyticsTool("get_profit", "Profit", "Revenue minus costs per day and for the period. USD cents.", analytics.getProfit);
analyticsTool("get_top_content", "Top content", "The best-performing posts and content types/networks by engagement for a period.", analytics.getTopContent);
analyticsTool("get_whats_working", "What is working", "What converts best: industries, traffic sources, landing pages, content types, networks and features used by paying vs churned users.", analytics.getWhatsWorking);
tool({
  name: "weekly_report",
  title: "Weekly report",
  kind: "read",
  description: "The weekly report: how BuPulse did (visits, sign-ups, revenue, costs, profit, versus the week before) and what is working. Default: the last 7 full days. Best tool for \"how did BuPulse do this week?\".",
  schema: rangeSchema,
  run: (a: RangeArgs) => analytics.weeklyReport(a.from || a.to || a.days ? resolveRange(a) : undefined),
});

// ---- users, businesses, posts, errors, audit (read) --------------------------------------------------------

tool({
  name: "list_users",
  title: "List users",
  kind: "read",
  description: "Search and list users with plan, subscription status, usage this period, suspension state and last activity. q matches email, name and business name. Newest first.",
  schema: z.object({
    q: z.string().max(100).optional().describe("Search text."),
    plan: PLAN.optional(),
    status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"]).optional().describe("Subscription status."),
    suspended: z.boolean().optional(),
    cursor,
    limit,
  }),
  run: (a) => admin.listUsers(a),
});
tool({ name: "get_user", title: "Get user", kind: "read", description: "One user in detail: plan, subscription, usage, business, post counts, leads, recent errors, recent approvals and last sign-in.", schema: z.object({ userId: id("User id (uuid).") }), run: (a) => admin.getUser(a.userId) });
tool({
  name: "list_businesses",
  title: "List businesses",
  kind: "read",
  description: "Search businesses by name, industry or owner email, with plan and counts of projects, posts, leads and connections.",
  schema: z.object({ q: z.string().max(100).optional(), cursor, limit }),
  run: (a) => admin.listBusinesses(a),
});
tool({ name: "get_business", title: "Get business", kind: "read", description: "One business in detail, with its connected accounts and post counts by status.", schema: z.object({ businessId: id("Business id.") }), run: (a) => admin.getBusiness(a.businessId) });
tool({
  name: "list_posts",
  title: "List posts",
  kind: "read",
  description: "Posts across all customers, newest first, filterable by status (e.g. FAILED), business, user and network. Use status=FAILED to find posts that rerun_failed_post can retry.",
  schema: z.object({
    status: z.enum(["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "PUBLISHED", "NEEDS_ACTION", "FAILED", "CANCELLED"]).optional(),
    businessId: z.string().max(100).optional(),
    userId: z.string().max(100).optional(),
    network: z.string().max(30).optional().describe("instagram, facebook, linkedin, tiktok or youtube."),
    since: day.optional(),
    until: day.optional().describe("Exclusive upper bound."),
    cursor,
    limit,
  }),
  run: (a) => admin.listPosts(a),
});
tool({
  name: "get_errors",
  title: "Server errors",
  kind: "read",
  description: "Recent server-side errors from the error log (publishing failures, webhook problems, job crashes), newest first.",
  schema: z.object({ level: z.enum(["error", "warn"]).optional(), source: z.string().max(100).optional().describe("Route, job or module name."), userId: z.string().max(100).optional(), since: day.optional(), cursor, limit }),
  run: (a) => admin.getErrors(a),
});
tool({
  name: "get_audit_log",
  title: "Audit log",
  kind: "read",
  description: "The append-only log of every admin action with before and after values. actor is \"admin\" or \"jarvis:<keyId>\"; target looks like user:<id>, flag:<key>, post:<id>, approval:<id>.",
  schema: z.object({ actor: z.string().max(100).optional(), action: z.string().max(60).optional().describe("e.g. extend_trial, suspend_user, approve_issue_refund."), target: z.string().max(120).optional(), since: day.optional(), until: day.optional(), cursor, limit }),
  run: (a) => admin.getAuditLog(a),
});
tool({ name: "get_approval", title: "Get approval", kind: "read", description: "Status of a money-action approval request: pending, approved, rejected, executed, failed or needs_check (Paddle may have acted; the owner verifies in Paddle, never retry), with the result once it has run.", schema: z.object({ id: id("Approval id returned by issue_refund or change_plan.") }), run: (a) => admin.getApproval(a.id) });
tool({ name: "list_approvals", title: "List approvals", kind: "read", description: "Money-action approval requests, newest first, optionally by status.", schema: z.object({ status: z.enum(["pending", "approved", "rejected", "executed", "failed", "needs_check"]).optional(), limit }), run: (a) => admin.listApprovals(a) });
tool({ name: "list_feature_flags", title: "List feature flags", kind: "read", description: "All feature flags with their switch, rollout percentage and per-user overrides.", schema: z.object({}), run: () => admin.listFeatureFlags() });

// ---- direct actions ----------------------------------------------------------------------------------------

tool({
  name: "extend_trial",
  title: "Extend trial",
  kind: "action",
  description: "Add 1-90 days to a user's free trial (counted from the later of now and the current end; also reactivates an expired trial). Only works for users still on the trial plan. Takes effect immediately and is written to the audit log.",
  schema: z.object({ userId: id("User id (uuid)."), days: z.number().int().min(1).max(90).describe("Days to add.") }),
  run: (a, ctx) => admin.extendTrial(ctx, a),
});
tool({
  name: "suspend_user",
  title: "Suspend user",
  kind: "action",
  description: "DESTRUCTIVE. Blocks the user from signing in and from using the app, the API and publishing until restored. Their data is kept. Requires confirm: true. Cannot suspend the admin account.",
  schema: z.object({ userId: id("User id (uuid)."), reason: z.string().max(300).optional().describe("Why (kept on the account)."), confirm: z.boolean().describe("Must be true.") }),
  run: (a, ctx) => admin.suspendUser(ctx, a),
});
tool({ name: "restore_user", title: "Restore user", kind: "action", description: "Lifts a suspension: the user can sign in and use BuPulse again.", schema: z.object({ userId: id("User id (uuid).") }), run: (a, ctx) => admin.restoreUser(ctx, a) });
tool({
  name: "set_feature_flag",
  title: "Set feature flag",
  kind: "action",
  description: "Create or update a feature flag. Decision order: per-user override, then enabled, then rolloutPercent (a stable share of users). userOverrides is merged; a value of null removes that user's override.",
  schema: z.object({
    key: z.string().min(1).max(64).describe("Lowercase letters, numbers, dots, dashes, underscores."),
    enabled: z.boolean().optional(),
    rolloutPercent: z.number().int().min(0).max(100).optional(),
    userOverrides: z.record(z.string(), z.boolean().nullable()).optional().describe("{ userId: true | false | null }"),
    description: z.string().max(200).optional(),
  }),
  run: (a, ctx) => admin.setFeatureFlag(ctx, a),
});
tool({
  name: "send_announcement",
  title: "Send announcement",
  kind: "action",
  description: "Publish an in-app announcement shown on customers' dashboards. audience \"all\" or \"plan\" (with plans). It goes live at startsAt (default now) and stops at endsAt (default never). This is visible to customers immediately: write it carefully.",
  schema: z.object({
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(2000),
    audience: z.enum(["all", "plan"]).optional().describe("Default all."),
    plans: z.array(PLAN).optional().describe("Required when audience is plan."),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    dismissible: z.boolean().optional().describe("Default true."),
  }),
  run: (a, ctx) => admin.sendAnnouncement(ctx, a),
});
tool({
  name: "update_plan_limits",
  title: "Update plan limits",
  kind: "action",
  description: "DESTRUCTIVE. Override a plan's usage limits at runtime (on top of the defaults in code); applies to all users of that plan within about 30 seconds. limits holds only the metrics to change: text, image, videoSeconds, voiceCharacters, chat (per billing period; trial: whole trial). null resets a metric to its default. Requires confirm: true.",
  schema: z.object({
    plan: PLAN,
    limits: z.object({ text: z.number().int().min(0).max(10_000_000).nullable(), image: z.number().int().min(0).max(10_000_000).nullable(), videoSeconds: z.number().int().min(0).max(10_000_000).nullable(), voiceCharacters: z.number().int().min(0).max(10_000_000).nullable(), chat: z.number().int().min(0).max(10_000_000).nullable() }).partial(),
    confirm: z.boolean().describe("Must be true."),
  }),
  run: (a, ctx) => admin.updatePlanLimits(ctx, a),
});
tool({
  name: "rerun_failed_post",
  title: "Rerun failed post",
  kind: "action",
  description: "Put a FAILED post back in the publishing queue to be published now (attempts reset). Refuses any other status; a NEEDS_ACTION post is never re-sent because it may already be live on the network.",
  schema: z.object({ postId: id("Post id.") }),
  run: (a, ctx) => admin.rerunFailedPost(ctx, a),
});

// ---- money actions (approval requests only) ----------------------------------------------------------------

const idem = z.string().min(8).max(128).describe("REQUIRED unique key for this request (8-128 chars: letters, numbers . _ : -). Repeating the same key returns the same approval instead of creating another; use a fresh key for a genuinely new request.");

tool({
  name: "issue_refund",
  title: "Request a refund",
  kind: "money",
  description:
    MONEY_NOTE +
    "Prepares a Paddle refund for a user: the whole transaction, or a partial amount. If transactionId is omitted, the user's latest completed payment is used when the owner approves.",
  schema: z.object({
    userId: id("User id (uuid)."),
    transactionId: z.string().max(100).optional().describe("Paddle transaction id (txn_...). Default: the latest completed one."),
    amountMinor: z.number().int().positive().optional().describe("Partial refund in the currency's smallest unit (cents), checked against the line item's total. Omit for a full refund."),
    lineItemId: z.string().max(100).optional().describe("Which line item a partial refund applies to (pri/txnitm id); needed only when the payment has several."),
    reason: z.string().min(1).max(300).describe("Reason, shown to the owner and sent to Paddle."),
    idempotencyKey: idem,
  }),
  run: (a, ctx) => admin.requestRefund(ctx, a),
});
tool({
  name: "change_plan",
  title: "Change a user's plan",
  kind: "money",
  description:
    "Change a user's plan. STANDARD or PRO changes the Paddle subscription and charges or credits money, so " +
    MONEY_NOTE.replace("MONEY ACTION: ", "") +
    "The user must already have a paid subscription. TRIAL (free) is not a money action: it is applied immediately, needs confirm: true and no idempotency key.",
  schema: z.object({
    userId: id("User id (uuid)."),
    plan: PLAN,
    interval: z.enum(["MONTH", "YEAR"]).optional().describe("Billing interval; default: unchanged."),
    idempotencyKey: idem.optional().describe("REQUIRED for STANDARD and PRO (8-128 chars: letters, numbers . _ : -). Same key = same approval."),
    confirm: z.boolean().optional().describe("Must be true when moving a user to TRIAL."),
  }),
  run: (a, ctx) => admin.requestChangePlan(ctx, a),
});


tool({
  name: "list_plans",
  title: "List plans",
  kind: "read",
  description: "The plans clients can buy or be on: key, name, status (active, hidden, retired), monthly and yearly price in cents, usage limits, highlights (pricing-card bullets), features (keys of the feature registry: content, designs, aiPhotos, calendar, gallery, websiteChat, autopilot, analytics, canva, storeImport, driveImport, webhooks, apiAccess, ownComposio, managed), how many clients are on each, paying clients, MRR and whether the Paddle prices are in sync. Use the key with change_plan and update_plan.",
  schema: z.object({}),
  run: () => admin.listPlansForTools(),
});
tool({
  name: "update_plan",
  title: "Update a plan",
  kind: "money",
  description:
    "Change a plan's name, description, status, order, highlight, trial length, usage limits, highlights or features (applied immediately and written to the audit log; needs confirm: true), and/or its prices. " +
    "features is the full list of feature keys the plan unlocks (see list_plans); every prerequisite must be included (autopilot needs content, designs, calendar and gallery; aiPhotos and canva need designs; analytics needs calendar; driveImport needs gallery) and video/voice are coming soon and refused. " +
    MONEY_NOTE.replace("MONEY ACTION: this does NOT move money. It only creates", "A PRICE change does not apply at once: it only creates") +
    "Prices are in cents. A price change needs an idempotencyKey and returns priceChangeApproval with the approval id.",
  schema: z
    .object({
      plan: id("Plan key (see list_plans)."),
      name: z.string().min(1).max(60).optional(),
      description: z.string().max(300).optional(),
      status: z.enum(["active", "hidden", "retired"]).optional(),
      sortOrder: z.number().int().min(0).max(1000).optional(),
      highlight: z.boolean().optional(),
      trialDays: z.number().int().min(0).max(90).optional(),
      limits: z.object({ text: z.number().int().min(0).max(10_000_000), image: z.number().int().min(0).max(10_000_000), chat: z.number().int().min(0).max(10_000_000), videoSeconds: z.number().int().min(0).max(10_000_000), voiceCharacters: z.number().int().min(0).max(10_000_000) }).partial().optional(),
      highlights: z.array(z.string().min(1).max(120)).max(12).optional().describe("Pricing-card bullets, replacing the current ones."),
      features: z.array(z.string().min(1).max(40)).max(30).optional().describe("Feature keys the plan unlocks, replacing the current list."),
      capabilities: z.object({ apiAccess: z.boolean(), ownComposio: z.boolean() }).partial().optional().describe("Older alias: switches those two features on or off."),
      monthlyPriceCents: z.number().int().min(0).max(10_000_000).optional().describe("New monthly price in cents. Creates an approval."),
      yearlyPriceCents: z.number().int().min(0).max(10_000_000).optional().describe("New yearly price in cents. Creates an approval."),
      confirm: z.boolean().describe("Must be true."),
      idempotencyKey: idem.optional().describe("REQUIRED when a price is included (8-128 chars: letters, numbers . _ : -)."),
    })
    .superRefine((a, ctx) => {
      if ((a.monthlyPriceCents !== undefined || a.yearlyPriceCents !== undefined) && !a.idempotencyKey) ctx.addIssue({ code: "custom", path: ["idempotencyKey"], message: "idempotencyKey is required with a price change." });
    }),
  run: (a, ctx) => admin.updatePlanFromTool(ctx, a as never),
});


// ---- companies and their users (console: /admin/companies/<businessId>) ----------------------------------------

const ROLE = z.enum(["OWNER", "ADMIN", "MEMBER"]);
const confirmField = z.boolean().describe("Must be true.");

tool({
  name: "list_companies",
  title: "List companies",
  kind: "read",
  description: "Search companies (a business and its team) with plan, status and seats used. q matches company name, owner email and team emails. In the console a company is at /admin/companies/<businessId>.",
  schema: z.object({ q: z.string().max(100).optional(), plan: PLAN.optional(), status: z.string().max(30).optional(), cursor, limit }),
  run: (a) => companies.listCompanies(a),
});
tool({
  name: "get_company",
  title: "Get company",
  kind: "read",
  description: "One company in detail: its users with roles, pending invites, seat limit and plan. Emails of team members are masked unless they are the owner's.",
  schema: z.object({ businessId: id("Business id.") }),
  run: (a) => companies.getCompany(a.businessId),
});
tool({
  name: "create_company_user",
  title: "Add a user to a company",
  kind: "action",
  description: "SENSITIVE. Adds a team member to a company. The sign-in is created with NO password and the person is emailed a link to set their own; an admin never sets or sees a password. Respects the plan's seat limit. Requires confirm: true.",
  schema: z.object({ businessId: id("Business id."), email: z.string().email().max(254), role: z.enum(["ADMIN", "MEMBER"]), name: z.string().max(100).optional(), confirm: confirmField }),
  run: (a, ctx) => companies.createCompanyUser(ctx, a),
});
tool({
  name: "change_user_email",
  title: "Change a user's email",
  kind: "action",
  description: "SENSITIVE (account takeover risk). Asks to change a user's sign-in email. It does NOT run by itself: the owner approves it in the admin console (Approvals), and only then the new address is confirmed, the OLD address is notified, every session of that user is ended, and sendReset can email a reset link to the new one. Needs an idempotencyKey and confirm: true.",
  schema: z.object({ userId: id("User id (uuid)."), newEmail: z.string().email().max(254), sendReset: z.boolean().optional().describe("Also email a reset link to the new address."), idempotencyKey: z.string().min(8).max(128).describe("Reuse the same key when retrying."), confirm: confirmField }),
  run: (a, ctx) => admin.requestChangeUserEmail(ctx, a),
});
tool({
  name: "request_make_company_owner",
  title: "Ask to make someone a company's owner",
  kind: "action",
  description: "SENSITIVE (billing and deleting the company). Asks to hand a company's ownership to one of its users; the previous owner becomes an Admin. It does NOT run by itself: the owner approves it in the admin console (Approvals). Needs an idempotencyKey and confirm: true.",
  schema: z.object({ userId: id("User id (uuid) of the person who becomes owner."), idempotencyKey: z.string().min(8).max(128), confirm: confirmField }),
  run: (a, ctx) => admin.requestMakeCompanyOwner(ctx, a),
});
tool({
  name: "send_password_reset",
  title: "Send a password reset",
  kind: "action",
  description: "Emails the user a password-reset link at their address on file. The admin never sees or sets the password. Requires confirm: true.",
  schema: z.object({ userId: id("User id (uuid)."), confirm: confirmField }),
  run: (a, ctx) => companies.sendPasswordReset(ctx, a),
});
tool({
  name: "remove_company_user",
  title: "Remove a user from a company",
  kind: "action",
  description: "DESTRUCTIVE. Removes a team member from their company. The company keeps exactly one owner, so the owner cannot be removed (hand ownership over first). Requires confirm: true.",
  schema: z.object({ userId: id("User id (uuid)."), confirm: confirmField }),
  run: (a, ctx) => companies.removeCompanyUser(ctx, a),
});
tool({
  name: "change_company_user_role",
  title: "Change a user's role in a company",
  kind: "action",
  description: "DESTRUCTIVE. Sets a team member's role to ADMIN or MEMBER. Making someone OWNER is refused here: use request_make_company_owner, which the owner approves in the console. The company always keeps exactly one owner. Requires confirm: true.",
  schema: z.object({ userId: id("User id (uuid)."), role: ROLE, confirm: confirmField }),
  run: (a, ctx) => companies.changeCompanyUserRole(ctx, a),
});

// ---- services, AI budget, connections, health, activity, Client 360 --------------------------------------------

/** Over MCP the client's own customers are not shown in full: lead names and emails are masked like team emails in get_company. */
function maskClientLeads<T extends { leads?: { leads?: { name?: string | null; email?: string | null }[] } }>(client: T): T {
  const leads = client.leads?.leads;
  if (!leads) return client;
  const maskName = (n: string | null | undefined) => (n ? `${n.trim().slice(0, 1)}***` : n);
  return { ...client, leads: { ...client.leads, leads: leads.map((l) => ({ ...l, name: maskName(l.name), email: l.email ? companies.maskEmail(l.email) : l.email })) } };
}

const SERVICE = z.enum(SERVICE_IDS).describe("Service id.");

tool({
  name: "list_services",
  title: "List services",
  kind: "read",
  description: "Every outside service BuPulse depends on (Gemini, Resend, Paddle, Supabase, Meta, LinkedIn, TikTok, YouTube, Canva, Drive, Dropbox, Shopify, WooCommerce, Cloudflare, Turnstile): purpose, which environment variables are set or missing (never their values), whether it is switched on, health, last test result, last error and 30-day usage. Start here for \"is anything broken?\".",
  schema: z.object({}),
  run: () => services.listServices(),
});
tool({
  name: "test_service",
  title: "Test a service",
  kind: "action",
  description: "Runs the service's cheap health check now (a free call such as a models list; OAuth-only services check their configuration) and stores the result. Safe to run any time; it never sends anything to a client.",
  schema: z.object({ service: SERVICE }),
  run: (a, ctx) => services.testService(ctx, a.service),
});
tool({
  name: "set_service_enabled",
  title: "Switch a service on or off",
  kind: "action",
  description: "DESTRUCTIVE when turning off. The kill switch for one outside service. Off: the features that use it show \"temporarily unavailable\" and wait (scheduled posts stay scheduled, the website chat keeps collecting leads, emails are skipped); nothing is deleted, and Paddle and Supabase webhooks keep being received. Turning off needs confirm: true and a reason. Supabase and Turnstile cannot be switched off.",
  schema: z.object({ service: SERVICE, enabled: z.boolean(), reason: z.string().max(200).optional().describe("Required when enabled is false."), confirm: z.boolean().optional().describe("Must be true when enabled is false.") }),
  run: (a, ctx) => services.setServiceEnabled(ctx, a),
});
tool({
  name: "get_ai_usage",
  title: "AI usage and budget",
  kind: "read",
  description: "AI spend for a month against the monthly cap: spent, remaining, whether AI is paused, projection to month end, spend per day, model, feature and client (top spenders), and failed calls with the most common errors. Costs are USD estimates from the AI call ledger.",
  schema: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("YYYY-MM; default the current month."), topLimit: z.number().int().min(1).max(50).optional().describe("How many top spenders (default 10).") }),
  run: (a) => aiUsage.getAiUsage(a),
});
tool({
  name: "set_ai_budget",
  title: "Set the monthly AI budget",
  kind: "action",
  description: "DESTRUCTIVE. Changes the monthly AI spending cap in USD (1-1000; default from AI_MONTHLY_BUDGET_USD, $20). It applies within 30 seconds; setting it below what is already spent pauses all AI at once. null goes back to the environment default. Requires confirm: true.",
  schema: z.object({ monthlyUsd: z.number().min(1).max(1000).nullable(), confirm: z.boolean().describe("Must be true.") }),
  run: (a, ctx) => aiUsage.setAiBudget(ctx, a),
});
tool({
  name: "get_system_health",
  title: "System health",
  kind: "read",
  description: "Scheduled jobs (last run and whether overdue), queues and backlogs (publishing, webhooks, approvals), error rate and database size, with an overall status (ok, warning, problem) and a list of what needs attention.",
  schema: z.object({}),
  run: () => getSystemHealth(),
});
tool({
  name: "get_activity",
  title: "Activity feed",
  kind: "read",
  description: "The live activity feed, newest first: sign-ups, payments, errors and admin actions. Page back with before = the previous result's cursor; pass after to get only newer items.",
  schema: z.object({ before: z.string().max(100).optional(), after: z.string().max(100).optional(), types: z.array(z.string().max(30)).max(10).optional().describe("Filter by group."), limit: z.number().int().min(1).max(100).optional() }),
  run: (a) => getActivity(a),
});
tool({
  name: "get_client_360",
  title: "Client 360",
  kind: "read",
  description: "Everything about one client in one answer: overview, billing, usage, channels, content, leads, errors, admin audit history and private notes.",
  schema: z.object({ userId: id("User id (uuid).") }),
  run: async (a) => maskClientLeads(await clientView.getClient360(a.userId)),
});
tool({
  name: "list_connections",
  title: "List client connections",
  kind: "read",
  description: "Clients' connections with status, errors and usage. kind: channels (social accounts), stores (Shopify/WooCommerce), cloudflare, canva, imports (file import usage), webhooks, api_keys (clients' Pro API keys, never the key itself), widgets (website chat widgets), or client (everything for one businessId).",
  schema: z.object({ kind: z.enum(["channels", "stores", "cloudflare", "canva", "imports", "webhooks", "api_keys", "widgets", "client"]), businessId: z.string().max(100).optional().describe("Required for kind=client; filters channels."), q: z.string().max(100).optional(), status: z.string().max(30).optional(), network: z.string().max(30).optional(), cursor, limit }),
  run: (a) => {
    const { kind, businessId, ...rest } = a;
    switch (kind) {
      case "channels": return connections.listChannels({ ...rest, businessId });
      case "stores": return connections.listStoreConnections(rest);
      case "cloudflare": return connections.listCloudflareConnections(rest);
      case "canva": return connections.listCanvaConnections(rest);
      case "imports": return connections.listFileImportUsage(rest);
      case "webhooks": return connections.listWebhookEndpoints({ ...rest, state: rest.status });
      case "api_keys": return connections.listApiKeys(rest);
      case "widgets": return connections.listWidgets({ ...rest, state: rest.status });
      case "client":
        if (!businessId) throw new AdminError("invalid", "kind=client needs businessId.");
        return connections.getClientConnections(businessId);
    }
  },
});
tool({
  name: "force_disconnect_channel",
  title: "Force-disconnect a social channel",
  kind: "action",
  description: "DESTRUCTIVE. Revokes a client's social channel: tokens are removed and its scheduled posts are marked as needing a reconnect (nothing is deleted). Requires confirm: true.",
  schema: z.object({ connectionId: id("Connection id."), reason: z.string().max(200).optional(), confirm: z.boolean().describe("Must be true.") }),
  run: (a, ctx) => connectionActions.forceDisconnectChannel(ctx, a),
});
tool({
  name: "disconnect_connector",
  title: "Disconnect a connector",
  kind: "action",
  description: "DESTRUCTIVE. Disconnects a client's store (id = store connection id), Cloudflare (id = business id) or Canva account (id = Canva connection id) like the client's own Disconnect; imported products and files stay. Requires confirm: true.",
  schema: z.object({ kind: z.enum(["store", "cloudflare", "canva"]), id: id("The id for that kind."), reason: z.string().max(200).optional(), confirm: z.boolean().describe("Must be true.") }),
  run: (a, ctx) => connectionActions.disconnectConnector(ctx, a),
});
tool({
  name: "revoke_client_api_key",
  title: "Revoke a client's API key",
  kind: "action",
  description: "DESTRUCTIVE. Revokes one of a client's Pro API keys at once. Requires confirm: true.",
  schema: z.object({ keyId: id("API key id."), reason: z.string().max(200).optional(), confirm: z.boolean().describe("Must be true.") }),
  run: (a, ctx) => connectionActions.revokeClientApiKey(ctx, a),
});
tool({
  name: "switch_off_widget",
  title: "Switch off a client's chat widget",
  kind: "action",
  description: "DESTRUCTIVE. Turns a business's website chat widget off (it stops answering and collecting leads on their site; existing leads stay). Needs a reason and confirm: true.",
  schema: z.object({ businessId: id("Business id."), reason: z.string().min(3).max(200), confirm: z.boolean().describe("Must be true.") }),
  run: (a, ctx) => connectionActions.switchOffWidget(ctx, a),
});
tool({
  name: "switch_on_widget",
  title: "Switch a client's chat widget back on",
  kind: "action",
  description: "Turns a business's website chat widget back on.",
  schema: z.object({ businessId: id("Business id.") }),
  run: (a, ctx) => connectionActions.switchOnWidget(ctx, a),
});

export const TOOLS: readonly Tool[] = defs;
export const TOOL_NAMES = defs.map((t) => t.name);

export function findTool(name: string) {
  return defs.find((t) => t.name === name) ?? null;
}

/** JSON Schema (draft 2020-12) of a tool's arguments. */
export function inputSchemaOf(t: Tool) {
  const { $schema: _unused, ...schema } = z.toJSONSchema(t.schema, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;
  void _unused;
  return schema;
}

/**
 * Validates and runs a tool. Throws AdminError for anything the caller can fix (bad arguments, missing confirm or
 * idempotency key, not found, conflict). The result is plain JSON (dates as ISO strings).
 */
export async function callTool(name: string, rawArgs: unknown, ctx: AdminContext): Promise<unknown> {
  const t = findTool(name);
  if (!t) throw new AdminError("not_found", `Unknown tool "${name}".`);
  const parsed = t.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue.path[0] ?? "");
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    if (field === "idempotencyKey") throw new AdminError("idempotency_required", `idempotencyKey is required for this money action (8-128 characters: letters, numbers, . _ : -).`);
    if (field === "confirm") throw new AdminError("confirm_required", `${name} is destructive. Send confirm: true to proceed.`);
    throw new AdminError("invalid", `${where}${issue.message}`);
  }
  const result = await t.run(parsed.data as never, ctx);
  return JSON.parse(JSON.stringify(result ?? null));
}
