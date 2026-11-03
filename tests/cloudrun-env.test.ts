import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inside, parseNetlifyEnv, toCloudRunEnv, toYaml } from "@/scripts/cloudrun-env.mjs";

const SECRET = "s3cr3t-value-that-must-never-be-printed-0123456789";

describe("Netlify env to Cloud Run env", () => {
  it("reads the CLI's flat JSON and the API's list (production, then all contexts)", () => {
    expect(parseNetlifyEnv('{"A":"1","B":"two"}')).toEqual({ A: "1", B: "two" });
    expect(parseNetlifyEnv("note: something first\n{\"A\":\"1\"}")).toEqual({ A: "1" });
    const api = [
      { key: "A", values: [{ context: "dev", value: "d" }, { context: "production", value: "p" }] },
      { key: "B", values: [{ context: "all", value: "x" }] },
      { key: "C", values: [{ context: "dev", value: "only dev" }] },
    ];
    expect(parseNetlifyEnv(JSON.stringify(api))).toEqual({ A: "p", B: "x" });
    expect(() => parseNetlifyEnv("nothing here")).toThrow(/no JSON/);
  });

  it("drops Netlify's own, build-only and Cloud Run's reserved names, keeps the 6543 DATABASE_URL, sets PLATFORM", () => {
    const { env, dropped, hidden } = toCloudRunEnv({
      DATABASE_URL: "postgresql://u:p@pooler.supabase.com:6543/postgres",
      DIRECT_URL: "postgresql://u:p@db:5432/postgres",
      CRON_SECRET: SECRET,
      NEXT_PUBLIC_SITE_URL: "https://bupulse.com",
      PLATFORM: "netlify",
      DEPLOY_TARGET: "netlify",
      NETLIFY_AUTH_TOKEN: "t",
      URL: "https://bupulse.netlify.app",
      PORT: "3000",
      K_SERVICE: "x",
      AUTOPILOT_NETLIFY_AI_PICTURES: "1",
      EMPTY: "",
      HIDDEN_ONE: "********",
    });
    expect(env).toEqual({ DATABASE_URL: "postgresql://u:p@pooler.supabase.com:6543/postgres", CRON_SECRET: SECRET, NEXT_PUBLIC_SITE_URL: "https://bupulse.com", PLATFORM: "cloudrun" });
    expect(dropped).toEqual(["AUTOPILOT_NETLIFY_AI_PICTURES", "DEPLOY_TARGET", "DIRECT_URL", "K_SERVICE", "NETLIFY_AUTH_TOKEN", "PLATFORM", "PORT", "URL"]);
    expect(hidden).toEqual(["HIDDEN_ONE"]);
  });

  it("writes YAML strings that keep quotes, backslashes, newlines and non-ASCII exactly", () => {
    const yaml = toYaml({ B: 'say "hi" \\ there\nnext', A: "Kigali é", C: "123" });
    expect(yaml).toBe('A: "Kigali é"\nB: "say \\"hi\\" \\\\ there\\nnext"\nC: "123"\n');
  });

  it("knows what is inside a folder", () => {
    expect(inside("/repo", "/repo/x.yaml")).toBe(true);
    expect(inside("/repo", "/repo")).toBe(true);
    expect(inside("/repo", "/repository/x.yaml")).toBe(false);
    expect(inside("/repo", "/home/me/x.yaml")).toBe(false);
  });
});

describe("scripts/cloudrun-env.mjs", () => {
  const input = JSON.stringify({ CRON_SECRET: SECRET, DATABASE_URL: `postgresql://${SECRET}@pooler:6543/db`, NETLIFY_SITE_ID: "site" });

  it("writes the file (mode 600) and prints names only, never a value", () => {
    const dir = mkdtempSync(join(tmpdir(), "cloudrun-env-"));
    try {
      const out = join(dir, "env.yaml");
      const run = spawnSync("node", ["scripts/cloudrun-env.mjs", out], { input, encoding: "utf8" });
      expect(run.stdout + run.stderr).not.toContain(SECRET);
      expect(run.stdout).toContain("NETLIFY_SITE_ID");
      expect(readFileSync(out, "utf8")).toContain(`CRON_SECRET: "${SECRET}"`);
      expect(readFileSync(out, "utf8")).toContain('PLATFORM: "cloudrun"');
      expect(statSync(out).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a path inside the repository, and bad JSON without echoing it", () => {
    const inRepo = spawnSync("node", ["scripts/cloudrun-env.mjs", "cloudrun.env.yaml"], { input, encoding: "utf8" });
    expect(inRepo.status).toBe(1);
    expect(inRepo.stdout).toContain("outside the repository");
    const dir = mkdtempSync(join(tmpdir(), "cloudrun-env-"));
    try {
      const bad = spawnSync("node", ["scripts/cloudrun-env.mjs", join(dir, "e.yaml")], { input: `{"CRON_SECRET": "${SECRET}" oops`, encoding: "utf8" });
      expect(bad.status).toBe(1);
      expect(bad.stdout + bad.stderr).not.toContain(SECRET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the Cloud Run image never receives a secret", () => {
  it.each([".dockerignore", ".gcloudignore"])("%s keeps .env files and env YAML out", (file) => {
    const lines = readFileSync(file, "utf8").split("\n").map((l) => l.trim());
    for (const pattern of [".env", ".env.*", "*.env.yaml", "*cloudrun-env*.yaml"]) expect(lines).toContain(pattern);
  });

  it("git sees no .env file other than the example as part of the build context", () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n");
    expect(tracked.filter((f) => /(^|\/)\.env/.test(f))).toEqual([".env.example"]);
  });
});
