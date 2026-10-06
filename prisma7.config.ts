import "dotenv/config";
import { defineConfig } from "prisma/config";

// The Prisma CLI (migrations) uses Supabase's direct/session connection.
// The app at runtime uses DATABASE_URL (the pooled connection) via lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
