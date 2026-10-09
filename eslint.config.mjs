import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cloudflare / test output:
    ".open-next/**",
    ".wrangler/**",
    "lib/generated/**",
    "playwright-report/**",
    "test-results/**",
    "cloudflare-env.d.ts",
    // Demo video project (own package and toolchain):
    "Demo/**",
  ]),
]);

export default eslintConfig;
