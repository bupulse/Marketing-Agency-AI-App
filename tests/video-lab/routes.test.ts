import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import MODELS from "@/video-lab/site/models.json";
import { OWNER_PAGES, ROUTES, isOwnerOnly } from "@/video-lab/scope";

// A route added to video-lab/server.ts without saying who may use it (video-lab/scope.ts ROUTES) fails here, so a new
// route is never silently open to every signed-in client.
const server = readFileSync("video-lab/server.ts", "utf8");
const policy = new Set(ROUTES.map((r) => (typeof r.path === "string" ? r.path : r.path.source)));

const literals = [...server.matchAll(/\bp === "(\/[^"]*)"/g)].map((m) => m[1]);
const prefixes = [...server.matchAll(/\bp\.startsWith\("(\/[^"]*)"\)/g)].map((m) => m[1]);
const regexes = [...server.matchAll(/\bp\.match\(\/(\^.+?\$)\/[a-z]*\)/g)].map((m) => m[1]);

describe("every route of the studio server has a policy", () => {
  it("finds the routes in server.ts", () => {
    expect(literals.length).toBeGreaterThan(40);
    expect(regexes.length).toBeGreaterThan(15);
  });

  it("covers each literal path", () => {
    // "/app/video/seedance" is a redirect rule, not a route of its own (a page: see below).
    const missing = literals.filter((l) => l !== "/app/video/seedance" && !policy.has(l));
    expect(missing).toEqual([]);
  });

  it("covers each regex route", () => {
    expect(regexes.filter((r) => !policy.has(r))).toEqual([]);
  });

  it("covers each prefix route (fonts); the generic /api/ rule is the gate's", () => {
    expect(prefixes.filter((x) => x !== "/api/" && !policy.has(x))).toEqual([]);
  });

  it("gives each policy a sample that the route matches", () => {
    for (const r of ROUTES) {
      const path = r.sample.split("?")[0];
      if (typeof r.path === "string") expect(r.path.endsWith("/") ? path.startsWith(r.path) : path === r.path, r.sample).toBe(true);
      else expect(r.path.test(path), r.sample).toBe(true);
    }
  });

  it("says owner for the research, developer and test tools and for nothing a client needs", () => {
    const owner = ROUTES.filter((r) => r.who === "owner").map((r) => `${r.method} ${r.sample}`);
    expect(owner).toEqual(expect.arrayContaining(["GET /api/viral", "GET /lab", "GET /app.js", "GET /api/businesses", "POST /api/wallet/topup", "POST /api/sample", "POST /api/template-previews", "GET /viral/frames/tiktok/vt-tt-001/f1.jpg"]));
    for (const needed of ["POST /api/design", "GET /api/jobs", "GET /api/wallet", "POST /api/upload", "POST /api/image", "GET /api/session"]) expect(owner).not.toContain(needed);
  });

  it("refuses a client the JSON owner routes up front, and leaves the owner's pages to the 404 page", () => {
    expect(isOwnerOnly("GET", "/api/businesses")).toBe(true);
    expect(isOwnerOnly("POST", "/api/influencers/amina/portrait")).toBe(true);
    expect(isOwnerOnly("GET", "/api/viral")).toBe(true);
    expect(isOwnerOnly("GET", "/lab")).toBe(false);
    expect(isOwnerOnly("POST", "/api/design")).toBe(false);
  });
});

describe("pages", () => {
  it("keeps the research and developer pages the owner's, and lists no other page as owner-only", () => {
    expect([...OWNER_PAGES].sort()).toEqual(["/api-docs", "/viral"]);
    expect(MODELS.length).toBeGreaterThan(0);
    for (const m of MODELS) expect(OWNER_PAGES.has(m.route)).toBe(false);
  });
});
