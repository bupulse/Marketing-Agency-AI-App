import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEATURE_ICONS, NAV_ITEMS } from "@/components/app/nav";
import { SERVICE_IDS } from "@/lib/admin/service-catalog";
import {
  BUILT_APP_FEATURE_KEYS,
  BUILT_FEATURE_KEYS,
  FEATURE_KEYS,
  FEATURES,
  dependentsOf,
  featureForRoute,
  findCycle,
  isFeatureKey,
  sortFeatureKeys,
  validateFeatureSet,
  withPrerequisites,
} from "@/lib/features";
import { CORE_FEATURES, PRO_FEATURES, SEED_PLANS, USAGE_METRICS } from "@/lib/plans";

describe("the feature registry", () => {
  it("describes every key once, with real prerequisites, services and metrics", () => {
    expect(FEATURES.map((f) => f.key)).toEqual([...FEATURE_KEYS]);
    for (const f of FEATURES) {
      expect(f.label.length, f.key).toBeGreaterThan(0);
      expect(f.description.length, f.key).toBeGreaterThan(0);
      for (const need of f.requires) expect(isFeatureKey(need), `${f.key} needs ${need}`).toBe(true);
      expect(f.requires, `${f.key} needs itself`).not.toContain(f.key);
      for (const s of f.services) expect(SERVICE_IDS, `${f.key} uses ${s}`).toContain(s);
      if (f.metric) expect(USAGE_METRICS).toContain(f.metric);
    }
  });

  it("covers the catalog of the launch plan (section 4)", () => {
    expect(BUILT_FEATURE_KEYS).toEqual(["content", "designs", "aiPhotos", "calendar", "gallery", "websiteChat", "autopilot", "analytics", "canva", "storeImport", "driveImport", "webhooks", "apiAccess", "ownComposio", "managed", "video", "voice"]);
    // Voiceover was built 13 October 2026 (docs/VOICE_AND_MUSIC.md). The Video Studio's two features are coming soon
    // until the studio moves into the app (docs/VIDEO_APP_INTEGRATION.md): they cannot be put in a plan yet.
    expect(FEATURES.filter((f) => f.status === "coming_soon").map((f) => f.key)).toEqual(["videoStudio", "aiVideo"]);
    expect(FEATURES.find((f) => f.key === "videoStudio")).toMatchObject({ requires: ["video"], metric: "videoCredits", services: ["claude"] });
    expect(FEATURES.find((f) => f.key === "aiVideo")).toMatchObject({ requires: ["videoStudio"], metric: "videoCredits", services: ["seedance"] });
    expect(FEATURES.filter((f) => f.kind === "service").map((f) => f.key)).toEqual(["ownComposio", "managed"]);
    expect(FEATURES.find((f) => f.key === "autopilot")!.requires).toEqual(["content", "designs", "calendar", "gallery"]);
    expect(FEATURES.find((f) => f.key === "aiPhotos")!.requires).toEqual(["designs"]);
    expect(FEATURES.find((f) => f.key === "canva")!.requires).toEqual(["designs"]);
    expect(FEATURES.find((f) => f.key === "analytics")!.requires).toEqual(["calendar"]);
    expect(FEATURES.find((f) => f.key === "driveImport")!.requires).toEqual(["gallery"]);
  });

  it("has no cycle (and the check finds one when there is)", () => {
    expect(findCycle()).toBeNull();
    expect(findCycle([
      { key: "content", requires: ["designs"] },
      { key: "designs", requires: ["gallery"] },
      { key: "gallery", requires: ["content"] },
    ])).toEqual(["content", "designs", "gallery", "content"]);
  });

  it("has an icon for every feature and a feature for every gated sidebar item", () => {
    for (const key of FEATURE_KEYS) expect(FEATURE_ICONS[key], key).toBeTruthy();
    const byHref = Object.fromEntries(NAV_ITEMS.map((i) => [i.href, i.feature]));
    expect(byHref).toMatchObject({
      "/dashboard": null,
      // The Knowledge base landing is open on every plan; its products and campaigns pages need `content`.
      "/dashboard/knowledge": null,
      "/dashboard/content": "content",
      "/dashboard/calendar": "calendar",
      "/dashboard/analytics": "analytics",
      "/dashboard/autopilot": "autopilot",
      "/dashboard/gallery": "gallery",
      "/dashboard/designs": "designs",
      "/dashboard/leads": "websiteChat",
      "/dashboard/widget": "websiteChat",
      "/dashboard/connections": "calendar",
      "/dashboard/connectors": null,
      "/dashboard/billing": null,
      "/dashboard/settings": null,
    });
  });
});

describe("withPrerequisites", () => {
  it("adds what a feature needs, through the whole chain, in registry order", () => {
    expect(withPrerequisites(["autopilot"])).toEqual(["content", "designs", "calendar", "gallery", "autopilot"]);
    expect(withPrerequisites(["canva", "aiPhotos"])).toEqual(["designs", "aiPhotos", "canva"]);
    expect(withPrerequisites(["analytics", "driveImport"])).toEqual(["calendar", "gallery", "analytics", "driveImport"]);
  });

  it("drops unknown keys and keeps a closed set as it is", () => {
    expect(withPrerequisites(["nope", "webhooks"])).toEqual(["webhooks"]);
    expect(withPrerequisites(PRO_FEATURES)).toEqual(sortFeatureKeys(PRO_FEATURES));
  });
});

describe("dependentsOf", () => {
  it("names the selected features that need a key, directly or through another", () => {
    const selected = ["content", "designs", "calendar", "gallery", "autopilot", "aiPhotos", "analytics"];
    expect(dependentsOf("designs", selected)).toEqual(["aiPhotos", "autopilot"]);
    expect(dependentsOf("calendar", selected)).toEqual(["autopilot", "analytics"]);
    expect(dependentsOf("autopilot", selected)).toEqual([]);
    expect(dependentsOf("designs", ["designs", "webhooks"])).toEqual([]);
  });
});

describe("validateFeatureSet", () => {
  it("accepts a closed set and returns it cleaned and ordered", () => {
    expect(validateFeatureSet(["webhooks", "content", "content"])).toEqual({ ok: true, keys: ["content", "webhooks"] });
    expect(validateFeatureSet(CORE_FEATURES)).toEqual({ ok: true, keys: CORE_FEATURES });
    expect(validateFeatureSet([])).toEqual({ ok: true, keys: [] });
  });

  it("names unknown keys and missing prerequisites, in words", () => {
    const out = validateFeatureSet(["autopilot", "nope", "designs"]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems).toEqual([
      { kind: "unknown", key: "nope" },
      { kind: "missing", key: "content", neededBy: ["autopilot"] },
      { kind: "missing", key: "calendar", neededBy: ["autopilot"] },
      { kind: "missing", key: "gallery", neededBy: ["autopilot"] },
    ]);
    expect(out.message).toContain('"nope" is not a feature');
    expect(out.message).toContain("AI content is needed by Autopilot");
  });
});

describe("featureForRoute", () => {
  it("maps dashboard paths to the feature that unlocks them (longest prefix wins)", () => {
    expect(featureForRoute("/dashboard/autopilot")).toBe("autopilot");
    expect(featureForRoute("/dashboard/projects/abc/edit")).toBe("content");
    expect(featureForRoute("/dashboard/knowledge/products/abc/edit")).toBe("content");
    expect(featureForRoute("/dashboard/knowledge/campaigns")).toBe("content");
    expect(featureForRoute("/dashboard/knowledge/profile")).toBeNull();
    expect(featureForRoute("/dashboard/connectors/api")).toBe("apiAccess");
    expect(featureForRoute("/dashboard/connectors/webhooks")).toBe("webhooks");
    expect(featureForRoute("/dashboard/connectors")).toBeNull();
    expect(featureForRoute("/dashboard/settings/team")).toBeNull();
  });
});

describe("the seed plans and the plan_features migration agree", () => {
  const sql = readFileSync("prisma/migrations/20261009110000_plan_features/migration.sql", "utf8");

  it("core = every built app feature but the API; Pro = all of them plus own Composio; Managed is sold apart", () => {
    expect(CORE_FEATURES).toEqual(BUILT_APP_FEATURE_KEYS.filter((k) => k !== "apiAccess" && k !== "video" && k !== "voice"));
    expect(PRO_FEATURES).toEqual(sortFeatureKeys([...BUILT_APP_FEATURE_KEYS, "ownComposio"]));
    expect(PRO_FEATURES).not.toContain("managed");
    expect(SEED_PLANS.TRIAL.features).toEqual(sortFeatureKeys([...CORE_FEATURES, "video", "voice"])); // one sample video
    expect(SEED_PLANS.STANDARD.features).toEqual(CORE_FEATURES);
    expect(SEED_PLANS.PRO.features).toEqual(PRO_FEATURES);
    for (const plan of Object.values(SEED_PLANS)) expect(validateFeatureSet(plan.features).ok, plan.name).toBe(true);
  });

  it("backfills the same core list, and the two capabilities for PRO or when a plan already had them", () => {
    const list = /jsonb_array_elements_text\(\s*'(\[[^']*\])'::jsonb/.exec(sql);
    expect(list).not.toBeNull();
    expect(JSON.parse(list![1])).toEqual(CORE_FEATURES);
    expect(sql).toContain(`SELECT 'apiAccess' WHERE "key" = 'PRO' OR "capabilities"->>'apiAccess' = 'true'`);
    expect(sql).toContain(`SELECT 'ownComposio' WHERE "key" = 'PRO' OR "capabilities"->>'ownComposio' = 'true'`);
    expect(sql).toContain(`SET "highlights" = "features"`);
    // Nullable with no default: a plan an older build creates after the migration reads as core + capabilities, not as empty.
    expect(sql).toContain(`ADD COLUMN "featureKeys" JSONB;`);
    expect(sql).not.toMatch(/"featureKeys" JSONB NOT NULL/);
  });
});
