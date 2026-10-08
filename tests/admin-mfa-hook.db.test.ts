import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Calls the hook function in the real database. Skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/admin-mfa-hook.db.test.ts
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL);

describe.skipIf(!enabled)("hook_mfa_verification_attempt", () => {
  const user = randomUUID();
  const factor = randomUUID();
  let db: Client;
  const call = async (valid: boolean) => {
    const r = await db.query("select public.hook_mfa_verification_attempt($1::jsonb) as r", [JSON.stringify({ user_id: user, factor_id: factor, factor_type: "totp", valid })]);
    return r.rows[0].r as { decision: string; message?: string };
  };

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
  });
  afterAll(async () => {
    await db.query('delete from public."AdminMfaFailure" where "userId" = $1', [user]);
    await db.end();
  });

  it("lets a correct code through", async () => {
    expect((await call(true)).decision).toBe("continue");
  });

  it("allows 5 wrong codes, then rejects everything, even a correct code", async () => {
    for (let i = 0; i < 5; i++) expect((await call(false)).decision).toBe("continue");
    expect((await call(false)).decision).toBe("reject");
    const locked = await call(true);
    expect(locked.decision).toBe("reject");
    expect(locked.message).toMatch(/Wait 10 minutes/);
  });

  it("is not callable by the public roles and has RLS on", async () => {
    const priv = await db.query(
      `select has_function_privilege('anon','public.hook_mfa_verification_attempt(jsonb)','execute') a,
              has_function_privilege('authenticated','public.hook_mfa_verification_attempt(jsonb)','execute') b,
              has_function_privilege('supabase_auth_admin','public.hook_mfa_verification_attempt(jsonb)','execute') c,
              (select relrowsecurity from pg_class where relname = 'AdminMfaFailure') rls`,
    );
    expect(priv.rows[0]).toEqual({ a: false, b: false, c: true, rls: true });
  });
});
