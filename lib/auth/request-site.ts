import "server-only";
import { headers } from "next/headers";
import { inBackgroundJob } from "@/lib/platform/background-job";
import { publicSiteUrl, servedOriginOf, siteUrl } from "./site-url";

// Which address a link or a redirect uses (docs/RELEASE_2.0.md, "Links follow the host"). Three kinds:
// - requestSiteUrl(): redirects and cookies of the request being answered: the host the visitor is on (when it is
//   one we serve), else siteUrl(). Outside a request (crons, scripts): siteUrl().
// - linkSiteUrl(): links in emails and pages a person opens later: the visitor's host inside a request, else
//   publicSiteUrl() (PUBLIC_LINK_URL: on the test machine the https://test.bupulse.com tunnel, in production
//   https://bupulse.com), never localhost from a background job.
// - siteUrl(): addresses registered with an outside provider (OAuth redirect URIs) stay deliberate.
// In production NEXT_PUBLIC_SITE_URL is https://bupulse.com and AUTH_EXTRA_ORIGINS / PUBLIC_LINK_URL are empty, so
// all three are https://bupulse.com whatever Host header arrives.

/** The served origin of the current request, or null outside a request (or for a Host we do not serve). */
async function currentOrigin(): Promise<string | null> {
  // A scheduled job has a request (the cron call) but no visitor: no host to follow.
  if (inBackgroundJob()) return null;
  try {
    return servedOriginOf(await headers());
  } catch {
    // headers() throws outside a request scope (a cron's work after the response, a script, a test).
    return null;
  }
}

export async function requestSiteUrl(): Promise<string> {
  return (await currentOrigin()) ?? siteUrl();
}

export async function linkSiteUrl(): Promise<string> {
  return (await currentOrigin()) ?? publicSiteUrl();
}

/** Cookies are Secure when the address the visitor is on is https. */
export async function secureCookies(): Promise<boolean> {
  return (await requestSiteUrl()).startsWith("https://");
}
