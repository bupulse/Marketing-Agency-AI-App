import type { MetadataRoute } from "next";
import { site } from "@/lib/content/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/api/", "/auth/", "/login", "/signup", "/forgot-password", "/reset-password"] },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
