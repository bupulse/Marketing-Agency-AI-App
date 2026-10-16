import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, ADMIN_PAGES, breadcrumbsFor, findNavItem, searchPages } from "@/components/admin/nav";

const ROOT = join(process.cwd(), "app/admin/(console)");

/** Every page.tsx under the console, as its URL (route groups dropped, dynamic segments kept). */
function pageUrls(dir = ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pageUrls(p));
    else if (name === "page.tsx") {
      const segs = relative(ROOT, dir).split("/").filter((s) => s && !/^\(.*\)$/.test(s));
      out.push(`/admin${segs.length ? `/${segs.join("/")}` : ""}`);
    }
  }
  return out;
}

describe("admin map", () => {
  it("puts every console page in a sidebar folder (details pages under their list)", () => {
    const missing = pageUrls().filter((url) => !findNavItem(url.replace(/\[[^\]]+\]/g, "x")));
    expect(missing).toEqual([]);
  });

  it("links only to pages that exist, each once, each with a one-line explanation", () => {
    const urls = new Set(pageUrls());
    const hrefs = ADMIN_PAGES.map((p) => p.href);
    expect(hrefs.filter((h) => !urls.has(h))).toEqual([]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const p of ADMIN_PAGES) expect(p.description.length).toBeGreaterThan(20);
  });

  it("keeps every old URL (no page moved)", () => {
    const urls = new Set(pageUrls());
    for (const old of ["/admin", "/admin/revenue", "/admin/payments", "/admin/companies", "/admin/companies/[id]", "/admin/settings/regions", "/admin/settings/updates", "/admin/invoices/[id]", "/admin/ai", "/admin/approvals", "/admin/health", "/admin/jarvis", "/admin/funnels", "/admin/activity", "/admin/users/[id]"]) {
      expect(urls.has(old), old).toBe(true);
    }
  });

  it("has the folders the owner asked for", () => {
    expect(ADMIN_NAV.map((g) => g.title)).toEqual([null, "Sales", "Clients", "Money", "Content", "AI and usage", "System", "Organisation"]);
  });

  it("matches the most specific page and builds breadcrumbs", () => {
    expect(findNavItem("/admin/settings/regions")?.label).toBe("Regions");
    expect(findNavItem("/admin/settings")?.label).toBe("Settings");
    expect(breadcrumbsFor("/admin/invoices/abc")).toEqual([{ label: "Admin", href: "/admin" }, { label: "Money" }, { label: "Invoices", href: "/admin/invoices" }, { label: "Details" }]);
    expect(breadcrumbsFor("/admin/offers/new").at(-1)).toEqual({ label: "New" });
    expect(breadcrumbsFor("/admin")).toEqual([{ label: "Overview" }]);
  });

  it("finds pages by name, folder or keyword", () => {
    expect(searchPages("cost")[0].href).toBe("/admin/costs");
    expect(searchPages("momo").map((p) => p.href)).toContain("/admin/payments");
    expect(searchPages("churn").map((p) => p.href)).toContain("/admin/revenue");
    expect(searchPages("zzzz")).toEqual([]);
  });
});
