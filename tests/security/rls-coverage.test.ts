import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every table in public is reachable through Supabase's Data API (/rest/v1) unless RLS is on and the API roles have
// no grants. The app reaches its tables only through Prisma (postgres), so every model's table needs both, in some
// migration. This fails when a new model (or one renamed with @@map) misses either.

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "prisma", "migrations");

function modelTables(): string[] {
  const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
  return [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? name);
}

function migrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((d) => existsSync(join(MIGRATIONS, d, "migration.sql")))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8").replace(/--[^\n]*/g, "") }));
}

const ALL_SQL = migrations()
  .map((m) => m.sql)
  .join("\n");

function hasRls(table: string): boolean {
  return new RegExp(`ALTER TABLE (?:IF EXISTS )?(?:public\\.)?"${table}" ENABLE ROW LEVEL SECURITY`).test(ALL_SQL);
}

/** A REVOKE ... ON [TABLE] <list naming the table> FROM <roles including anon and authenticated>. */
function hasRevoke(table: string): boolean {
  return [...ALL_SQL.matchAll(/REVOKE\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+(?:TABLE\s+)?([^;]*?)\s+FROM\s+([^;]*);/gi)].some(
    ([, targets, roles]) => new RegExp(`(^|[\\s,])(?:public\\.)?"${table}"(?=[\\s,]|$)`).test(targets) && /\banon\b/.test(roles) && /\bauthenticated\b/.test(roles),
  );
}

describe("RLS and grants on every table", () => {
  const tables = modelTables();

  it("reads the models", () => {
    expect(tables.length).toBeGreaterThan(50);
    expect(tables).toEqual(expect.arrayContaining(["User", "WebhookEndpoint", "WebhookDelivery", "ApiKey"]));
  });

  it("every model's table has ENABLE ROW LEVEL SECURITY", () => {
    expect(tables.filter((t) => !hasRls(t))).toEqual([]);
  });

  it("every model's table has its grants revoked from anon and authenticated", () => {
    expect(tables.filter((t) => !hasRevoke(t))).toEqual([]);
  });

  it("the checker itself catches a missing table", () => {
    expect(hasRls("NoSuchTable")).toBe(false);
    expect(hasRevoke("NoSuchTable")).toBe(false);
    // "User" must not match inside another name such as "UserFollow".
    expect(new RegExp(`(^|[\\s,])"Use"(?=[\\s,]|$)`).test(`"User", "Business"`)).toBe(false);
  });

  it("new tables and sequences get no API grants by default", () => {
    expect(ALL_SQL).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role/);
    expect(ALL_SQL).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role/);
  });
});

describe("Storage write policies", () => {
  const last = (policy: string) => [...migrations()].reverse().find((m) => m.sql.includes(`CREATE POLICY ${policy}`));

  it("the newest INSERT and UPDATE policies refuse a read-only account", () => {
    for (const policy of ["bupulse_own_folder_insert", "bupulse_own_folder_update"]) {
      const m = last(policy);
      expect(m, policy).toBeDefined();
      expect(m!.sql).toMatch(/AND NOT \(SELECT public\.bupulse_account_blocked\(\)\)/);
    }
  });

  it("bupulse_account_blocked covers suspension, deletion and every read-only subscription state, and only signed-in users may run it", () => {
    const m = migrations().find((x) => x.sql.includes("FUNCTION public.bupulse_account_blocked()"))!;
    expect(m.sql).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/);
    expect(m.sql).toMatch(/auth\.uid\(\)/);
    for (const needle of ['"suspendedAt" IS NOT NULL', '"deletionScheduledFor" IS NOT NULL', "'PENDING_DEMO'", "'EXPIRED'", "'PAST_DUE'", "'CANCELED'", '"trialEndsAt" < now()']) {
      expect(m.sql).toContain(needle);
    }
    expect(m.sql).toMatch(/REVOKE ALL ON FUNCTION public\.bupulse_account_blocked\(\) FROM PUBLIC, anon, authenticated, service_role;/);
    expect(m.sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bupulse_account_blocked\(\) TO authenticated;/);
  });

  it("the policies still check the folder and the brand manager rule", () => {
    const m = last("bupulse_own_folder_insert")!;
    expect(m.sql).toContain("bupulse_company_folder()");
    expect(m.sql).toContain("bupulse_can_manage_company()");
    expect(m.sql).toContain("bucket_id IN ('brand', 'media', 'designs')");
  });
});
