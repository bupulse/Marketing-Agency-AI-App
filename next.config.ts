import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  // Inlined at build time for the admin Updates page (lib/version.ts). BUILD_SHA comes from the deploy workflow.
  // BUPULSE_BUILD_PLATFORM: "netlify" when Netlify builds the app (it sets NETLIFY=true), else PLATFORM or empty, read by
  // lib/platform/detect.ts when PLATFORM is not set at runtime.
  env: {
    APP_VERSION: version,
    BUILD_SHA: process.env.BUILD_SHA ?? process.env.COMMIT_REF ?? "local",
    BUPULSE_BUILD_PLATFORM: process.env.PLATFORM ?? (process.env.NETLIFY === "true" ? "netlify" : ""),
  },
  // The file tracer only keeps pg-cloudflare's no-op build; Workers needs the real
  // socket implementation that `pg` loads when running on Cloudflare.
  // The @jsquash .wasm files are read from node_modules at runtime in Node (lib/publishing/jpeg.ts), which the tracer
  // cannot see; Netlify's function is built from the traced files, so list them.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/**/pg-cloudflare/{dist,esm}/**", "./node_modules/@jsquash/{png,jpeg,webp}/codec/**/*.wasm"],
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
