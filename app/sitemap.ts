import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/content/blog";
import { site } from "@/lib/content/site";
import { listedCampaigns } from "@/lib/creators/marketplace";
import { logError } from "@/lib/errors";

const pages = ["", "/pricing", "/done-for-you", "/industries", "/about", "/contact", "/partners", "/blog", "/creators", "/login", "/privacy", "/terms", "/refund-policy", "/data-deletion"];

// The marketplace's campaigns change through the day (docs/CREATOR_MARKETPLACE.md): the sitemap is made again hourly.
export const revalidate = 3600;

/** The campaigns on the marketplace now (unlisted and hidden ones are left out); none when the database is unreachable. */
async function campaignPages(now: Date): Promise<MetadataRoute.Sitemap> {
  try {
    const campaigns = await listedCampaigns(now, { details: false });
    return campaigns.map((c) => ({ url: `${site.url}/c/${c.slug}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.6 }));
  } catch (error) {
    await logError(error, { source: "sitemap.creators" }).catch(() => {});
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  return [
    ...pages.map((path) => ({
      url: `${site.url}${path}`,
      lastModified: now,
      changeFrequency: path === "/creators" ? ("daily" as const) : path === "" || path === "/blog" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "" ? 1 : path === "/pricing" ? 0.9 : 0.7,
    })),
    ...(await campaignPages(now)),
    ...getAllPosts().map((post) => ({
      url: `${site.url}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
  ];
}
