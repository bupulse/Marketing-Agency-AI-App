import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { activeGroup, bottomBarItems, createActions, finderEntries, isActive, NAV_GROUPS, NAV_ITEMS, navFor, searchEntries } from "@/components/app/nav";
import { BUILT_APP_FEATURE_KEYS, type FeatureKey } from "@/lib/features";

const ROOT = join(process.cwd(), "app/dashboard");
const ALL: FeatureKey[] = [...BUILT_APP_FEATURE_KEYS];

/** Every page.tsx under the dashboard, as its URL. */
function pageUrls(dir = ROOT): Set<string> {
  const out = new Set<string>();
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pageUrls(p).forEach((u) => out.add(u));
    else if (name === "page.tsx") {
      const segs = relative(ROOT, dir).split("/").filter((s) => s && !/^\(.*\)$/.test(s));
      out.add(`/dashboard${segs.length ? `/${segs.join("/")}` : ""}`);
    }
  }
  return out;
}

const labels = (groups: ReturnType<typeof navFor>) => groups.map((g) => [g.title, g.items.map((i) => i.label)]);
const hrefs = (list: { href: string }[]) => list.map((i) => i.href);
const without = (...keys: FeatureKey[]) => ALL.filter((k) => !keys.includes(k));

describe("menu groups", () => {
  it("has the groups and names the owner chose", () => {
    expect(labels([...NAV_GROUPS])).toEqual([
      [null, ["Home"]],
      ["Create", ["Posts", "Videos", "Designs", "Photos", "Autopilot"]],
      ["Publish", ["Calendar", "Channels", "Creators", "Link in bio"]],
      ["Customers", ["Inbox", "Leads", "Contacts", "Automations", "Website chat"]],
      ["Results", ["Analytics"]],
      ["My business", ["Business info", "Brand"]],
      ["Account & settings", ["Billing", "Team", "Usage", "Settings", "Connectors"]],
    ]);
  });

  it("links only to pages that exist, each once, with the same URLs as before", () => {
    const urls = pageUrls();
    expect(hrefs(NAV_ITEMS).filter((h) => !urls.has(h))).toEqual([]);
    expect(new Set(hrefs(NAV_ITEMS)).size).toBe(NAV_ITEMS.length);
    expect(NAV_ITEMS.find((i) => i.label === "Posts")?.href).toBe("/dashboard/content");
    expect(NAV_ITEMS.find((i) => i.label === "Photos")?.href).toBe("/dashboard/gallery");
    expect(NAV_ITEMS.find((i) => i.label === "Business info")?.href).toBe("/dashboard/knowledge");
  });

  it("shows an owner on a full plan everything", () => {
    expect(navFor("OWNER", ALL).flatMap((g) => g.items)).toHaveLength(NAV_ITEMS.length);
  });

  it('lists "Coming soon" pages as such, never as a link: the inbox, contacts and automations (owner decision)', () => {
    expect(NAV_ITEMS.filter((i) => i.soon).map((i) => i.label)).toEqual(["Inbox", "Contacts", "Automations"]);
    // Shown to everyone whose role could use them, whatever the plan, and never opened from the bar or "Find a page".
    const soon = navFor("MEMBER", []).flatMap((g) => g.items).filter((i) => i.soon);
    expect(soon.map((i) => i.label)).toEqual(["Inbox", "Contacts", "Automations"]);
    expect(finderEntries("OWNER", [...ALL, "inbox", "automations"]).map((e) => e.label)).not.toContain("Inbox");
    expect(hrefs(bottomBarItems("OWNER", [...ALL, "inbox"]))).not.toContain("/dashboard/inbox");
  });

  it("puts Creators under Publish, for the roles that may run campaigns", () => {
    expect(NAV_ITEMS.find((i) => i.label === "Creators")).toMatchObject({ href: "/dashboard/creators", feature: "creators", permission: "creators" });
    expect(navFor("MEMBER", ALL).flatMap((g) => g.items.map((i) => i.label))).not.toContain("Creators");
  });

  it("hides pages a role may not open, and a group left empty", () => {
    const member = navFor("MEMBER", ALL);
    const items = member.flatMap((g) => g.items.map((i) => i.label));
    for (const hidden of ["Channels", "Link in bio", "Website chat", "Brand", "Billing", "Team", "Connectors"]) expect(items).not.toContain(hidden);
    expect(items).toContain("Usage");
    expect(navFor("ADMIN", ALL).flatMap((g) => g.items.map((i) => i.label))).not.toContain("Billing");
  });

  it("hides pages the plan lacks, and drops the group when nothing is left in it", () => {
    const groups = navFor("OWNER", without("analytics", "calendar"));
    expect(groups.map((g) => g.id)).not.toContain("results");
    const items = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(items).not.toContain("Calendar");
    expect(items).not.toContain("Channels");
    expect(items).toContain("Link in bio");
    // On no plan at all: the pages every plan has.
    expect(labels(navFor("MEMBER", []))).toEqual([
      [null, ["Home"]],
      ["Create", ["Videos"]],
      ["Customers", ["Inbox", "Contacts", "Automations"]],
      ["My business", ["Business info"]],
      ["Account & settings", ["Usage", "Settings"]],
    ]);
  });

  it("marks the open page and its group", () => {
    expect(isActive("/dashboard", "/dashboard")).toBe(true);
    expect(isActive("/dashboard/content", "/dashboard")).toBe(false);
    expect(isActive("/dashboard/knowledge/products/abc", "/dashboard/knowledge")).toBe(true);
    expect(isActive("/dashboard/settings/team", "/dashboard/settings")).toBe(false);
    expect(activeGroup("/dashboard/settings/team")).toBe("account");
    expect(activeGroup("/dashboard/billing")).toBe("account");
    expect(activeGroup("/dashboard/content/general")).toBe("create");
    expect(activeGroup("/dashboard")).toBe("home");
    expect(activeGroup("/dashboard/upgrade")).toBeNull();
  });
});

describe("+ Create", () => {
  it("offers the four actions, each to the page that starts it", () => {
    expect(createActions("MEMBER", ALL).map((a) => [a.label, a.href, !!a.external])).toEqual([
      ["New post", "/dashboard/content/general?create=1", false],
      ["New video", "/dashboard/video", false],
      ["New design", "/dashboard/designs", false],
      ["Add photo", "/dashboard/gallery?upload=1", false],
    ]);
  });

  it("opens the Video Studio in a new tab when it is available", () => {
    expect(createActions("OWNER", ALL, "open").find((a) => a.id === "video")).toMatchObject({ href: "/dashboard/video/open", external: true });
    expect(createActions("OWNER", ALL, "upgrade").find((a) => a.id === "video")).toMatchObject({ href: "/dashboard/video" });
  });

  it("leaves out what the plan lacks", () => {
    expect(createActions("OWNER", without("designs", "gallery")).map((a) => a.id)).toEqual(["post", "video"]);
    // Writing posts without posting: the Posts page, as the day view needs the calendar.
    expect(createActions("OWNER", without("calendar")).find((a) => a.id === "post")?.href).toBe("/dashboard/content");
    expect(createActions("OWNER", []).map((a) => a.id)).toEqual(["video"]);
  });
});

describe("phone bottom bar", () => {
  it("is Home, Calendar and Posts around the + while the inbox is coming soon", () => {
    expect(hrefs(bottomBarItems("MEMBER", ALL))).toEqual(["/dashboard", "/dashboard/calendar", "/dashboard/content"]);
  });

  it("gives a missing page's place to the next that fits, never twice", () => {
    expect(hrefs(bottomBarItems("OWNER", without("content")))).toEqual(["/dashboard", "/dashboard/calendar", "/dashboard/leads"]);
    expect(hrefs(bottomBarItems("OWNER", without("calendar")))).toEqual(["/dashboard", "/dashboard/content", "/dashboard/leads"]);
    expect(hrefs(bottomBarItems("OWNER", without("calendar", "content")))).toEqual(["/dashboard", "/dashboard/designs", "/dashboard/leads"]);
    expect(hrefs(bottomBarItems("OWNER", []))).toEqual(["/dashboard"]);
  });
});

describe("Find a page", () => {
  const entries = finderEntries("OWNER", ALL);
  const find = (q: string, list = entries) => searchEntries(q, list).map((e) => e.label);

  it("lists the Create actions first, and everything for an empty query", () => {
    expect(entries.slice(0, 4).map((e) => e.label)).toEqual(["New post", "New video", "New design", "Add photo"]);
    expect(find("")).toHaveLength(entries.length);
  });

  it("finds pages by name first, then by other words", () => {
    expect(find("photos")[0]).toBe("Photos");
    expect(find("payment")).toEqual(["Billing"]);
    expect(find("MoMo")).toEqual(["Billing"]);
    expect(find("mobile money")).toEqual(["Billing"]);
    expect(find("chat")[0]).toBe("Website chat");
    expect(find("Instagram")[0]).toBe("Channels");
    expect(find("knowledge")).toContain("Business info");
    expect(find("gallery")).toContain("Photos");
    expect(find("new")[0]).toBe("New post");
    expect(find("zzzz")).toEqual([]);
  });

  it("only lists what the role and plan may open", () => {
    const member = finderEntries("MEMBER", without("inbox"));
    expect(find("payment", member)).toEqual([]);
    expect(find("Instagram", member)).not.toContain("Channels");
    expect(member.map((e) => e.label)).not.toContain("Inbox");
    expect(finderEntries("OWNER", ALL, "open").find((e) => e.label === "New video")).toMatchObject({ external: true });
  });
});
