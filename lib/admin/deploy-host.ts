// Where deploys go: Cloudflare Workers (.github/workflows/deploy.yml) or Netlify (.github/workflows/deploy-netlify.yml).
// The Updates screen starts the workflow of the host BuPulse runs on; DEPLOY_TARGET=cloudflare|netlify overrides it.
// No server imports: used by lib/admin/github.ts, which tests load directly.

import { currentPlatform, type Platform } from "@/lib/platform/detect";

export type DeployHost = "cloudflare" | "netlify";

export type DeployHostInfo = {
  /** The workflow file in .github/workflows that deploys and rolls back on this host. */
  workflow: string;
  /** What runs the code, in the console's words. */
  runtime: string;
  /** How the rollback is done, for the dialog. */
  rollback: string;
  /** The audit log target of a rollback. */
  auditTarget: string;
  /** The GitHub `production` environment secrets the workflow needs. */
  secrets: string[];
  /** Where GITHUB_REPO and GITHUB_TOKEN are set for the running app. */
  runtimeSecrets: string;
};

export const DEPLOY_HOSTS: Record<DeployHost, DeployHostInfo> = {
  cloudflare: {
    workflow: "deploy.yml",
    runtime: "Worker",
    rollback: "GitHub runs wrangler rollback, which switches traffic to the previous Worker version within a minute.",
    auditTarget: "worker:bupulse",
    secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "DIRECT_URL"],
    runtimeSecrets: "In Cloudflare: npx wrangler secret put GITHUB_REPO (owner/name) and npx wrangler secret put GITHUB_TOKEN.",
  },
  netlify: {
    workflow: "deploy-netlify.yml",
    runtime: "Netlify site",
    rollback: "GitHub asks Netlify to publish the production deploy before the current one again (Netlify's restore deploy); it is live within seconds and costs no credits.",
    auditTarget: "netlify:site",
    secrets: ["NETLIFY_AUTH_TOKEN", "NETLIFY_SITE_ID", "DIRECT_URL"],
    runtimeSecrets: "In Netlify: Project configuration, Environment variables, add GITHUB_REPO (owner/name) and GITHUB_TOKEN (scope Functions), then redeploy.",
  },
};

/** DEPLOY_TARGET when set, else the host BuPulse runs on (anything that is not Netlify deploys to Cloudflare, as before). */
export function deployHost(env: Record<string, string | undefined> = process.env, platform: Platform = currentPlatform()): DeployHost {
  const forced = (env.DEPLOY_TARGET ?? "").trim().toLowerCase();
  if (forced === "netlify" || forced === "cloudflare") return forced;
  return platform === "netlify" ? "netlify" : "cloudflare";
}
