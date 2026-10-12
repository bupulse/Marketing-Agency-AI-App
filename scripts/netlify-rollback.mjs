// Rolls the Netlify site back to the production deploy before the one that is live now (Netlify's "Publish deploy"
// / restore deploy), through the Netlify API. Run by .github/workflows/deploy-netlify.yml (action: rollback).
//
//   NETLIFY_AUTH_TOKEN=... NETLIFY_SITE_ID=... node scripts/netlify-rollback.mjs
//
// Each run goes one deploy further back (running it twice lands two deploys back). To return to a newer deploy,
// install that release again from the admin console or publish it in the Netlify UI (Deploys, pick one, Publish deploy).
// Restoring a deploy costs no Netlify credits. Database migrations are never touched.

const API = "https://api.netlify.com/api/v1";

/**
 * The production deploy to go back to: in Netlify's list (newest first), the first ready deploy after the published
 * one. Null when the published one is not in the list or nothing older is ready.
 * @param {{ id: string; state?: string; context?: string }[]} deploys
 * @param {string | null | undefined} publishedId
 */
export function previousDeploy(deploys, publishedId) {
  const index = deploys.findIndex((d) => d.id === publishedId);
  if (index < 0) return null;
  return deploys.slice(index + 1).find((d) => d.state === "ready" && (d.context ?? "production") === "production") ?? null;
}

async function api(path, token, init = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "bupulse-deploy" } });
  if (!response.ok) throw new Error(`Netlify answered ${response.status} for ${init.method ?? "GET"} ${path}`);
  return response.json();
}

async function main() {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  const site = process.env.NETLIFY_SITE_ID;
  if (!token || !site) throw new Error("Set NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID.");
  const current = await api(`/sites/${encodeURIComponent(site)}`, token);
  const publishedId = current.published_deploy?.id ?? null;
  const deploys = await api(`/sites/${encodeURIComponent(site)}/deploys?production=true&per_page=50`, token);
  const target = previousDeploy(deploys, publishedId);
  if (!target) throw new Error(`No earlier production deploy to go back to (live: ${publishedId ?? "none"}).`);
  await api(`/sites/${encodeURIComponent(site)}/deploys/${encodeURIComponent(target.id)}/restore`, token, { method: "POST" });
  console.log(`Restored deploy ${target.id} (${target.commit_ref ?? "no commit"}, ${target.created_at}); it replaces ${publishedId}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
