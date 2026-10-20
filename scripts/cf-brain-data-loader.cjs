// Turbopack loader for the Cloudflare build only (next.config.ts, scripts/cf-build.mjs): a video brain data file
// (lib/video-engine/brain/data/*.json) becomes a require of the same file in @bupulse/video-brain-data, which the build
// copies from that folder. The package is in serverExternalPackages, so the Worker carries the data once instead of
// once per chunk group that reaches the brain (about 1.2 MB a copy). Same values: the package holds the files unchanged.
const path = require("node:path");

module.exports = function brainDataLoader() {
  return `module.exports = require(${JSON.stringify(`@bupulse/video-brain-data/${path.basename(this.resourcePath)}`)});\n`;
};
