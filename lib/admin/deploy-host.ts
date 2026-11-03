// Where deploys go: Cloudflare Workers (.github/workflows/deploy.yml), Netlify (.github/workflows/deploy-netlify.yml) or
// Google Cloud Run (.github/workflows/deploy-cloudrun.yml, not written yet: docs/DEPLOY_CLOUDRUN.md deploys by hand).
// The Updates screen starts the workflow of the host BuPulse runs on; DEPLOY_TARGET=cloudflare|netlify|cloudrun
// overrides it.
// No server imports: used by lib/admin/github.ts, which tests load directly.

import { currentPlatform, type Platform } from "@/lib/platform/detect";

export type DeployHost = "cloudflare" | "netlify" | "cloudrun";

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
  cloudrun: {
    workflow: "deploy-cloudrun.yml",
    runtime: "Cloud Run service",
    rollback: "GitHub sends all traffic back to the Cloud Run revision before the current one; it is live within seconds and nothing is rebuilt.",
    auditTarget: "cloudrun:bupulse",
    secrets: ["GCP_PROJECT_ID", "GCP_SERVICE_ACCOUNT_KEY", "DIRECT_URL"],
    runtimeSecrets: "In Google Cloud: gcloud run services update bupulse --region us-central1 --update-env-vars GITHUB_REPO=owner/name,GITHUB_TOKEN=... (docs/DEPLOY_CLOUDRUN.md).",
  },
};

/** DEPLOY_TARGET when set, else the host BuPulse runs on (anything that is not Netlify or Cloud Run deploys to Cloudflare, as before). */
export function deployHost(env: Record<string, string | undefined> = process.env, platform: Platform = currentPlatform()): DeployHost {
  const forced = (env.DEPLOY_TARGET ?? "").trim().toLowerCase();
  if (forced === "netlify" || forced === "cloudflare" || forced === "cloudrun") return forced;
  return platform === "netlify" ? "netlify" : platform === "cloudrun" ? "cloudrun" : "cloudflare";
}
