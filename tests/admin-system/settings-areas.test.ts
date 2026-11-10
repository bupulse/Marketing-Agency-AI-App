import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OLD_SETTINGS_ANCHORS, SETTINGS_SLUGS, SETTINGS_TITLE, hashTarget, isSettingsSlug, settingsBackFor, settingsHref } from "@/components/admin/system/settings-areas";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return (k: string) => f.has(k);
};

describe("settings areas", () => {
  it("every area has a title and a page address", () => {
    for (const slug of SETTINGS_SLUGS) {
      expect(SETTINGS_TITLE[slug]).toBeTruthy();
      expect(settingsHref(slug)).toBe(`/admin/settings/${slug}`);
      expect(isSettingsSlug(slug)).toBe(true);
    }
    expect(isSettingsSlug("regions")).toBe(false); // its own static page
    expect(isSettingsSlug("updates")).toBe(false);
    expect(isSettingsSlug("../x")).toBe(false);
  });

  it("each old #anchor opens the page that now holds its panel", () => {
    expect(OLD_SETTINGS_ANCHORS.momo).toBe("/admin/settings/momo");
    expect(OLD_SETTINGS_ANCHORS.paddle).toBe("/admin/settings/paddle");
    expect(OLD_SETTINGS_ANCHORS.goal).toBe("/admin/settings/goal");
    expect(OLD_SETTINGS_ANCHORS["google-calendar"]).toBe("/admin/settings/google-calendar");
    expect(OLD_SETTINGS_ANCHORS["lead-alerts"]).toBe("/admin/settings/lead-alerts");
    expect(OLD_SETTINGS_ANCHORS["language-voices"]).toBe("/admin/settings/voices");
    expect(OLD_SETTINGS_ANCHORS["daily-posts"]).toBe("/admin/settings/content#daily-posts");
    for (const to of Object.values(OLD_SETTINGS_ANCHORS)) expect(isSettingsSlug(to.replace("/admin/settings/", "").split("#")[0])).toBe(true);
  });

  it("covers every /admin/settings#anchor linked from the code", () => {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) for (const m of readFileSync(p, "utf8").matchAll(/\/admin\/settings#([a-z-]+)/g)) found.add(m[1]);
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(join(process.cwd(), dir));
    for (const anchor of found) expect(OLD_SETTINGS_ANCHORS, `#${anchor}`).toHaveProperty(anchor);
  });

  it("hashTarget keeps the notice and the new page's own anchor", () => {
    expect(hashTarget(OLD_SETTINGS_ANCHORS, "#momo", "?notice=Mobile%20Money%20details%20saved.")).toBe("/admin/settings/momo?notice=Mobile%20Money%20details%20saved.");
    expect(hashTarget(OLD_SETTINGS_ANCHORS, "#skit-videos", "")).toBe("/admin/settings/content#skit-videos");
    expect(hashTarget(OLD_SETTINGS_ANCHORS, "#google-calendar", "?error=x")).toBe("/admin/settings/google-calendar?error=x");
    expect(hashTarget(OLD_SETTINGS_ANCHORS, "", "?notice=x")).toBeNull();
    expect(hashTarget(OLD_SETTINGS_ANCHORS, "#nope", "")).toBeNull();
    expect(hashTarget(OLD_SETTINGS_ANCHORS, "#constructor", "")).toBeNull(); // own keys only
    expect(hashTarget({ "setup-meta": "/admin/services/meta" }, "#setup-meta", "?")).toBe("/admin/services/meta");
  });

  it("a save of the shared settings form returns to the page its form is on", () => {
    expect(settingsBackFor(form({ trialDays: "14" }))).toBe("/admin/settings/trial");
    expect(settingsBackFor(form({ pageLoader: "bar" }))).toBe("/admin/settings/loading");
    expect(settingsBackFor(form({ usdToRwf: "1450", cardMarginPercent: "8" }))).toBe("/admin/settings/currency");
    expect(settingsBackFor(form({ currencyPanel: "1", displayCurrency: "RWF", usdToEur: "0.9" }))).toBe("/admin/settings/currency");
    expect(settingsBackFor(form({ revenueGoalRwf: "9000000", goalStartMonth: "2026-11" }))).toBe("/admin/settings/goal");
    expect(settingsBackFor(form({ dailyPanel: "1" }))).toBe("/admin/settings/content#daily-posts");
    expect(settingsBackFor(form({ skitPanel: "1", skitVideos: "on" }))).toBe("/admin/settings/content#skit-videos");
    expect(settingsBackFor(form({ previewPanel: "1" }))).toBe("/admin/settings/content#first-post-preview");
    expect(settingsBackFor(form({ meetingLink: "", organizerEmail: "a@b.c", slotMinutes: "30" }))).toBe("/admin/settings/calls");
    expect(settingsBackFor(form({}))).toBe("/admin/settings");
  });
});
