import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BUILD_REQUIRED, checkEnv, cloudflareEnv, netlifyEnv, RUNTIME_RECOMMENDED, RUNTIME_REQUIRED, wranglerInfo } from "@/scripts/check-env.mjs";

const SECRET = "s3cr3t-value-that-must-never-be-printed-0123456789";
const good = {
  NEXT_PUBLIC_SITE_URL: "https://bupulse.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  DIRECT_URL: "postgresql://x",
  DATABASE_URL: "postgresql://y",
  SUPABASE_SECRET_KEY: SECRET,
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  API_KEY_PEPPER: SECRET,
  CRON_SECRET: SECRET,
  ADMIN_EMAILS: "admin@bupulse.com",
  AI_TEXT_PROVIDER: "gemini",
  GEMINI_API_KEY: SECRET,
  RESEND_API_KEY: SECRET,
};

describe("check-env: build", () => {
  it("needs the public build values and the migrations' DIRECT_URL, an https site address", () => {
    expect(checkEnv(good, "build").errors).toEqual([]);
    expect(checkEnv({}, "build").errors).toEqual(BUILD_REQUIRED.map((n) => `${n} is not set.`));
    expect(checkEnv({ ...good, NEXT_PUBLIC_SITE_URL: "http://bupulse.com" }, "build").errors).toEqual(["NEXT_PUBLIC_SITE_URL must be the https address of the site (no path)."]);
  });
});

describe("check-env: runtime", () => {
  it("a complete production setup passes, with warnings for features that switch off", () => {
    const { errors, warnings } = checkEnv(good, "runtime");
    expect(errors).toEqual([]);
    expect(warnings).toContain("ELEVENLABS_API_KEY is not set: voiceovers and Generate a track are off.");
    expect(warnings).toContain("VIDEO_ROBOT_SECRET is not set: the video robot is off: owners make videos in their browser.");
    expect(warnings.length).toBe(RUNTIME_RECOMMENDED.length);
  });

  it("the test tunnel's AUTH_EXTRA_ORIGINS and PUBLIC_LINK_URL must be empty in production: a warning each, never the value", () => {
    const { errors, warnings } = checkEnv({ ...good, AUTH_EXTRA_ORIGINS: "https://test.bupulse.com", PUBLIC_LINK_URL: "https://test.bupulse.com" }, "runtime");
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => /^(AUTH_EXTRA_ORIGINS|PUBLIC_LINK_URL) is set: leave it empty in production/.test(w))).toHaveLength(2);
    expect(warnings.join(" ")).not.toContain("test.bupulse.com");
    expect(checkEnv({ ...good, AUTH_EXTRA_ORIGINS: " " }, "runtime").warnings.some((w) => w.startsWith("AUTH_EXTRA_ORIGINS"))).toBe(false);
  });

  it("missing required values, development switches, bad formats and a provider without its key are errors", () => {
    expect(checkEnv({}, "runtime").errors).toEqual(expect.arrayContaining(RUNTIME_REQUIRED.map((n) => `${n} is not set.`)));
    const bad = checkEnv(
      { ...good, REGION_OVERRIDE: "1", ANALYTICS_DEV_COUNTRY: "RW", ENCRYPTION_KEY: "short", CRON_SECRET: "abc", WIDGET_AI_SHARE: "2", MEDIA_COMPANY_VIDEO_MAX_BYTES: "lots", AI_TEXT_PROVIDER: "claude", NEXT_PUBLIC_WHATSAPP_NUMBER: "call us" },
      "runtime",
    ).errors;
    expect(bad).toEqual(
      expect.arrayContaining([
        "REGION_OVERRIDE is set: it is for local development only. Remove it.",
        "ANALYTICS_DEV_COUNTRY is set: it is for local development only. Remove it.",
        "ENCRYPTION_KEY must be 32 bytes in base64 (openssl rand -base64 32).",
        "CRON_SECRET is too short: use at least 32 random characters.",
        "WIDGET_AI_SHARE must be between 0 and 1.",
        "MEDIA_COMPANY_VIDEO_MAX_BYTES must be a positive number.",
        "ANTHROPIC_API_KEY is not set (AI_TEXT_PROVIDER needs it).",
        "NEXT_PUBLIC_WHATSAPP_NUMBER must be an international phone number.",
      ]),
    );
    expect(checkEnv({ ...good, PLATFORM_CHECK: "1" }, "runtime").warnings).toContain("PLATFORM_CHECK is set: remove it after the post-deploy check.");
  });

  it("never prints a value, only names", () => {
    const all = checkEnv({ ...good, CRON_SECRET: "tiny-secret", ENCRYPTION_KEY: SECRET }, "runtime");
    for (const line of [...all.errors, ...all.warnings]) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("tiny-secret");
    }
  });

  it("from Netlify's names only (secret values are hidden): presence is checked, not formats", () => {
    const names = Object.fromEntries(Object.keys(good).map((k) => [k, "set"]));
    expect(checkEnv(names, "runtime", "names").errors).toEqual([]);
  });
});

describe("check-env: Netlify", () => {
  it("reads the production runtime variables' names with the token, never their values", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/sites/site-1")) return Response.json({ account_id: "acc-1" });
      return Response.json([
        { key: "DATABASE_URL", scopes: ["builds", "functions", "runtime"], values: [{ context: "all", value: "" }] },
        { key: "PREVIEW_ONLY", scopes: ["functions"], values: [{ context: "deploy-preview", value: "x" }] },
        { key: "BUILD_ONLY", scopes: ["builds"], values: [{ context: "production", value: "x" }] },
        { key: "CRON_SECRET", values: [{ context: "production" }] },
      ]);
    });
    expect(await netlifyEnv("tok", "site-1", fetchImpl as unknown as typeof fetch)).toEqual({ DATABASE_URL: "set", CRON_SECRET: "set" });
    expect(fetchImpl.mock.calls[1][0]).toBe("https://api.netlify.com/api/v1/accounts/acc-1/env?site_id=site-1");
    await expect(netlifyEnv("tok", "site-1", (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch)).rejects.toThrow("Netlify answered 401 for the site.");
  });
});

describe("check-env: Cloudflare", () => {
  it("reads the Worker's secret names with the token; Hyperdrive stands in for DATABASE_URL", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true, result: [{ name: "CRON_SECRET", type: "secret_text" }, { name: "RESEND_API_KEY", type: "secret_text" }] }));
    expect(await cloudflareEnv("tok", "acc-1", "bupulse", true, fetchImpl as unknown as typeof fetch)).toEqual({ CRON_SECRET: "set", RESEND_API_KEY: "set", DATABASE_URL: "set" });
    expect(fetchImpl.mock.calls[0]).toEqual(["https://api.cloudflare.com/client/v4/accounts/acc-1/workers/scripts/bupulse/secrets", { headers: { authorization: "Bearer tok" } }]);
    expect(await cloudflareEnv("tok", "acc-1", "bupulse", false, fetchImpl as unknown as typeof fetch)).not.toHaveProperty("DATABASE_URL");
    await expect(cloudflareEnv("tok", "acc-1", "bupulse", true, (async () => new Response("", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/no Worker named bupulse/);
    await expect(cloudflareEnv("tok", "acc-1", "bupulse", true, (async () => new Response("", { status: 403 })) as unknown as typeof fetch)).rejects.toThrow("Cloudflare answered 403 for the Worker's secrets.");
  });

  it("wrangler.jsonc: the Worker name and whether Hyperdrive has a real config id", () => {
    expect(wranglerInfo(readFileSync("wrangler.jsonc", "utf8")).name).toBe("bupulse");
    expect(wranglerInfo('{ "name": "bupulse", "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "TODO_HYPERDRIVE_CONFIG_ID" }] }')).toEqual({ name: "bupulse", hyperdrive: false });
    expect(wranglerInfo('{ "name": "bupulse", "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "0123456789abcdef0123456789abcdef" }] }')).toEqual({ name: "bupulse", hyperdrive: true });
  });
});

describe(".env.example", () => {
  const example = readFileSync(".env.example", "utf8");
  const listed = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  // Set by the host or the tooling, never by hand.
  const provided = new Set(["NODE_ENV", "NETLIFY", "LAMBDA_TASK_ROOT", "COMMIT_REF", "GITHUB_OUTPUT", "SELF_TEST_OUT", "BUPULSE_BUILD_PLATFORM", "APP_VERSION"]);

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (["node_modules", "generated", ".next", "local"].includes(name)) return [];
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|mjs|mts)$/.test(name) ? [path] : [];
    });
  }

  it("lists every variable the code reads, each empty", () => {
    const used = new Set<string>();
    for (const file of [...files("app"), ...files("lib"), ...files("components"), ...files("scripts"), ...files("netlify")]) {
      for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|process\.env\["([A-Z][A-Z0-9_]+)"\]/g)) used.add(m[1] ?? m[2]);
    }
    const missing = [...used].filter((n) => !listed.has(n) && !provided.has(n));
    expect(missing).toEqual([]);
    expect([...example.matchAll(/^[A-Z][A-Z0-9_]+=(.*)$/gm)].every((m) => m[1] === '""')).toBe(true);
    for (const name of [...RUNTIME_REQUIRED, ...BUILD_REQUIRED, ...RUNTIME_RECOMMENDED.map(([n]) => n), "ROBOT_APP_URL"]) expect(listed.has(name), name).toBe(true);
  });
});
