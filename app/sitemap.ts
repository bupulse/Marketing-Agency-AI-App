import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/content/blog";
import { site } from "@/lib/content/site";

const pages = ["", "/pricing", "/done-for-you", "/industries", "/about", "/contact", "/blog", "/login", "/privacy", "/terms", "/data-deletion"];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    ...pages.map((path) => ({
      url: `${site.url}${path}`,
      lastModified: now,
      changeFrequency: path === "" || path === "/blog" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "" ? 1 : path === "/pricing" ? 0.9 : 0.7,
    })),
    ...getAllPosts().map((post) => ({
      url: `${site.url}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
  ];
}
