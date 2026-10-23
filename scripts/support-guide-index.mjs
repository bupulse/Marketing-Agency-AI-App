#!/usr/bin/env node
// Rebuilds the support AI's guide index (SupportGuideChunk) from docs/guide/features/*.md, after the guide changes:
//
//   node --env-file=.env --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/support-guide-index.mjs [--dry-run]
//
// Uses DIRECT_URL (or DATABASE_URL). Hash-based and idempotent: only new or changed sections are written and sections
// that are gone are deleted, so running it twice changes nothing the second time. The server also fills an empty index
// on first use (lib/support/guide.ts); this script is how a guide edit reaches the AI without waiting for that.
// Prints counts only.

import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { GUIDE_FILE, hashInput, planGuideSync, splitGuide } from "../lib/support/guide-split.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "docs", "guide", "features");
const dryRun = process.argv.includes("--dry-run");

const files = readdirSync(DIR).filter((n) => GUIDE_FILE.test(n)).sort();
const chunks = files.flatMap((file) => splitGuide(file, readFileSync(join(DIR, file), "utf8"))).map((c) => ({ ...c, hash: createHash("sha256").update(hashInput(c)).digest("hex") }));

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL is not set (run with --env-file=.env).");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows: existing } = await client.query('SELECT "id", "file", "anchor", "hash" FROM "SupportGuideChunk"');
  const { upserts, deletes } = planGuideSync(existing, chunks);
  console.log(`${files.length} files, ${chunks.length} sections: ${upserts.length} to write, ${deletes.length} to delete${dryRun ? " (dry run)" : ""}.`);
  if (!dryRun) {
    await client.query("BEGIN");
    for (const c of upserts) {
      await client.query(
        `INSERT INTO "SupportGuideChunk" ("id", "file", "anchor", "title", "page", "heading", "body", "sort", "hash")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT ("file", "anchor") DO UPDATE SET "title" = $4, "page" = $5, "heading" = $6, "body" = $7, "sort" = $8, "hash" = $9`,
        [`g${randomUUID().replace(/-/g, "").slice(0, 24)}`, c.file, c.anchor, c.title, c.page, c.heading, c.body, c.sort, c.hash],
      );
    }
    if (deletes.length) await client.query('DELETE FROM "SupportGuideChunk" WHERE "id" = ANY($1)', [deletes]);
    await client.query("COMMIT");
    console.log("Done.");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Indexing failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
