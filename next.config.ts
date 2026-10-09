import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  // Inlined at build time for the admin Updates page (lib/version.ts). BUILD_SHA comes from the deploy workflow.
  env: { APP_VERSION: version, BUILD_SHA: process.env.BUILD_SHA ?? "local" },
  // The file tracer only keeps pg-cloudflare's no-op build; Workers needs the real
  // socket implementation that `pg` loads when running on Cloudflare.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/**/pg-cloudflare/{dist,esm}/**"],
  },
  async headers() {
    return [
      // Only the chat widget page may be framed (it sets its own frame-ancestors per business).
      {
        source: "/:path((?!widget/|widget\\.js|widget-chat\\.js).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      // Admin console: never cached, never indexed, never framed.
      {
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      { source: "/widget.js", headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }] },
      { source: "/widget-chat.js", headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" }] },
    ];
  },
};

export default nextConfig;
