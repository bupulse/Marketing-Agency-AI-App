import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  // Development only: the dev server blocks its scripts and live-reload for any host but localhost. The test tunnel
  // (test.bupulse.com → localhost:3001) needs to be allowed, or pages load but no button works there.
  allowedDevOrigins: ["test.bupulse.com"],
  // Hide the Next.js dev-tools button (the "N" bubble): the test site is shown to people as the real thing.
  devIndicators: false,
  // Heavy libraries used by both pages (server actions) and route handlers: kept as packages so the Cloudflare Worker
  // carries each one once (OpenNext bundles external packages once) instead of a copy per Turbopack chunk group.
  // Behaviour is the same; only where the code sits in the Worker changes (docs/DEPLOY.md, "Worker size").
  // @bupulse/prisma-data exists only in the Cloudflare build (scripts/cf-build.mjs): the generated Prisma client's data.
  serverExternalPackages: ["zod", "pdf-lib", "libphonenumber-js", "@bupulse/prisma-data"],
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
