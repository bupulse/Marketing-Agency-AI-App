import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The file tracer only keeps pg-cloudflare's no-op build; Workers needs the real
  // socket implementation that `pg` loads when running on Cloudflare.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/**/pg-cloudflare/{dist,esm}/**"],
  },
};

export default nextConfig;
