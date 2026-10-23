import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Deny by default: every admin page, route and server action names the permission it needs, and a person without it
// is refused before anything runs. Checked two ways: the source of every file, and by calling every server action as
// each built-in role.

class NotFound extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}
class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`);
  }
}

const h = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("next/navigation", () => ({ notFound: () => { throw new NotFound(); }, redirect: (u: string) => { throw new Redirect(u); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/admin/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/admin/auth")>();
  const identity = () => ({ id: "00000000-0000-4000-8000-000000000001", email: "staff@example.com", staffId: "s1", role: "test", roleName: "Test", permissions: h.permissions, isOwner: false, isSales: false });
  return {
    ...real,
    requireAdmin: async () => identity(),
    requirePermission: async (p: string | string[]) => {
      const id = identity();
      if (!real.can(id as never, p as never)) throw new NotFound();
      return id;
    },
    isAdminSession: async (p: string | string[]) => real.can(identity() as never, p as never),
  };
});
// Anything past the gate must not reach a real database or service: make every call fail loudly but not as a 404.
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: () => { throw new Error("db not available in this test"); } }) }));

import { ADMIN_PAGES } from "@/components/admin/nav";
import { BUILT_IN_ROLES, isPermission, permissionsOf, type Permission } from "@/lib/staff/permissions";

const ROOT = join(process.cwd(), "app/admin/(console)");
function files(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...files(p, name));
    else if (entry === name) out.push(p);
  }
  return out;
}
const urlOf = (file: string) => {
  const segs = relative(ROOT, file).split("/").slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return `/admin${segs.length ? `/${segs.join("/")}` : ""}`;
};
/** The permission literal(s) in a gate call: "x" or ["x", "y"]. */
const permsIn = (arg: string): string[] => [...arg.matchAll(/"([a-zA-Z.]+)"/g)].map((m) => m[1]);

describe("every admin page names its permission", () => {
  const pages = files(ROOT, "page.tsx");

  it("checks the permission of its menu entry (the Overview redirects instead)", () => {
    for (const file of pages) {
      const src = readFileSync(file, "utf8");
      const url = urlOf(file);
      if (url === "/admin") {
        expect(src, url).toMatch(/can\(me, "overview"\)/);
        continue;
      }
      const m = /requirePermission\(([^)]*)\)/.exec(src);
      expect(m, `${url} must call requirePermission`).not.toBeNull();
      expect(src, `${url} must not use the bare admin check`).not.toMatch(/\brequireAdmin\(\)/);
      const page = ADMIN_PAGES.filter((p) => url === p.href || url.startsWith(`${p.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
      expect(page, url).toBeDefined();
      const expected = typeof page!.perm === "string" ? [page!.perm] : [...page!.perm];
      expect(permsIn(m![1]).sort(), url).toEqual(expected.sort());
    }
  });
});

describe("every admin route names its permission", () => {
  it("answers 404 unless isAdminSession(permission)", () => {
    const routes = files(ROOT, "route.ts");
    expect(routes.length).toBeGreaterThan(0);
    for (const file of routes) {
      const src = readFileSync(file, "utf8");
      const m = /isAdminSession\(([^)]+)\)/.exec(src);
      expect(m, relative(ROOT, file)).not.toBeNull();
      for (const p of permsIn(m![1])) expect(isPermission(p), `${relative(ROOT, file)}: ${p}`).toBe(true);
    }
  });
});

describe("admin routes outside the console folder", () => {
  it("the Google Calendar connect and callback name their permission too", () => {
    for (const f of ["app/api/admin/google-calendar/connect/route.ts", "app/api/admin/google-calendar/callback/route.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).toMatch(/requirePermission\(\["system", "demos"\]\)/);
      expect(src, f).not.toMatch(/\brequireAdmin\(\)/);
    }
  });
});

const actionFiles = files(ROOT, "actions.ts");

/** Each exported action and the permission(s) its gate names, from the source. */
function gatedActions(): { file: string; name: string; perms: string[] }[] {
  const out: { file: string; name: string; perms: string[] }[] = [];
  for (const file of actionFiles) {
    const src = readFileSync(file, "utf8");
    // Local helpers that open with adminAction (staffManager, owner...) count as the gate of the actions calling them.
    const helpers = [...src.matchAll(/^async function (\w+)\(\)[^{]*\{([\s\S]*?)\n\}/gm)].flatMap((h) => {
      const gate = /adminAction\(([^)]*)\)/.exec(h[2]);
      return gate ? [{ name: h[1], gate }] : [];
    });
    for (const m of src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
      const body = m[2];
      const gate = /adminAction\(([^)]*)\)/.exec(body) ?? helpers.find((h) => new RegExp(`\\b${h.name}\\(\\)`).test(body))?.gate ?? null;
      out.push({ file, name: m[1], perms: gate ? permsIn(gate[1]) : [] });
    }
  }
  return out;
}

describe("every server action names its permission", () => {
  it("opens with adminAction(permission)", () => {
    const all = gatedActions();
    expect(all.length).toBeGreaterThan(50);
    const ungated = all.filter((a) => a.perms.length === 0 || a.perms.some((p) => !isPermission(p))).map((a) => `${relative(ROOT, a.file)} ${a.name}`);
    expect(ungated).toEqual([]);
  });
});

const form = () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ id: "x1", businessId: "b1", userId: "00000000-0000-4000-8000-000000000002", reason: "a reason", month: "2026-10", amount: "1", key: "k", name: "n", email: "a@b.co" })) f.set(k, v);
  return f;
};

async function outcome(fn: (...a: unknown[]) => Promise<unknown>): Promise<"denied" | "passed"> {
  try {
    // Actions used with useActionState take (previous state, form); the others take the form.
    await (fn.length >= 2 ? fn({}, form()) : fn(form()));
  } catch (e) {
    if (e instanceof NotFound) return "denied";
  }
  return "passed";
}

describe("server actions per role (called for real)", () => {
  beforeEach(() => {
    h.permissions = [];
  });

  it("refuses every action to someone with no permission", async () => {
    for (const a of gatedActions()) {
      const mod = (await import(/* @vite-ignore */ a.file)) as Record<string, (...x: unknown[]) => Promise<unknown>>;
      expect(await outcome(mod[a.name]), `${relative(ROOT, a.file)} ${a.name}`).toBe("denied");
    }
  }, 60_000);

  it("lets each built-in role through exactly the actions its permissions name", async () => {
    const actions = gatedActions();
    const mods = new Map<string, Record<string, (...x: unknown[]) => Promise<unknown>>>();
    for (const f of new Set(actions.map((a) => a.file))) mods.set(f, await import(/* @vite-ignore */ f));
    for (const role of BUILT_IN_ROLES) {
      h.permissions = permissionsOf(role.key);
      for (const a of actions) {
        const allowed = a.perms.some((p) => h.permissions.includes(p as Permission));
        expect(await outcome(mods.get(a.file)![a.name]), `${role.key}: ${relative(ROOT, a.file)} ${a.name}`).toBe(allowed ? "passed" : "denied");
      }
    }
  }, 120_000);
});

describe("the built-in roles", () => {
  const pagesOf = (key: string) => ADMIN_PAGES.filter((p) => (typeof p.perm === "string" ? [p.perm] : p.perm).some((x) => permissionsOf(key).includes(x))).map((p) => p.href);

  it("a sales agent sees only their clients and the leaderboard", () => {
    expect(pagesOf("sales_agent").sort()).toEqual(["/admin/sales", "/admin/sales/leaderboard"]);
  });
  it("only the owner and finance approve payments; only owner and IT manage staff; only the owner manages the screen", () => {
    const who = (p: Permission) => BUILT_IN_ROLES.filter((r) => r.permissions.includes(p)).map((r) => r.key).sort();
    expect(who("payments.approve")).toEqual(["finance", "owner"]);
    expect(who("staff.manage")).toEqual(["it", "owner"]);
    expect(who("screen.manage")).toEqual(["owner"]);
    expect(who("clients.reassign")).toEqual(["owner", "sales_manager"]);
  });
  it("a sales agent never sees client content, money or system pages", () => {
    const pages = pagesOf("sales_agent");
    for (const p of ["/admin/companies", "/admin/content", "/admin/revenue", "/admin/payments", "/admin/health", "/admin/organisation"]) expect(pages).not.toContain(p);
  });
  it("an unknown role has no permission at all", () => {
    expect(permissionsOf("deleted_custom_role")).toEqual([]);
  });
});
