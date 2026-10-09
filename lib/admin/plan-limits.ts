import "server-only";
import { clearPlanCache, getPlanLimits as loadPlanLimits } from "@/lib/plan-catalog";
import { USAGE_METRICS } from "@/lib/plans";

// Plan limits used to be code defaults plus runtime overrides. They are now the plan's own limits in the database
// (/admin/plans, or the update_plan_limits tool); this file keeps the names the rest of the code imports.
export { USAGE_METRICS };

/** Mark the cache stale (the writer calls this so its own isolate sees a change at once; others catch up within 30 s). */
export const clearPlanLimitCache = clearPlanCache;

/** A plan's limits, from the cached plan catalog. */
export const getPlanLimits = loadPlanLimits;
