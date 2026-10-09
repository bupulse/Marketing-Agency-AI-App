// Small pg helper for the demo capture scripts (development database from /Users/macbook1/BuPulse/.env).
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });
export const pool = new pg.Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, max: 3 });
export const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
