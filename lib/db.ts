import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { poolMax, requestDatabase } from "@/lib/platform/database";

const globalForPrisma = globalThis as unknown as {
  clients?: Map<typeof PrismaClient, PrismaClient>;
};

// On Cloudflare Workers the connection comes from the Hyperdrive binding (lib/platform/database.ts).
// On Netlify, locally and at build time there is no binding, so DATABASE_URL is used.

function createClient(connectionString: string | undefined) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: poolMax(),
      // Close idle connections before Supabase's pooler drops them, so no request picks up a
      // dead connection and hangs.
      idleTimeoutMillis: 20_000,
      keepAlive: true,
    }),
    // Opening a pooled connection far from the database (e.g. developing from Africa to us-east-1)
    // can take ~2 s, Prisma's default wait for a transaction to start. Give it more room.
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
}

// Workers cannot reuse database sockets across requests, so each request gets
// its own client (cached on the request's execution context).
const workerClients = new WeakMap<object, PrismaClient>();

function getClient(): PrismaClient {
  const workers = requestDatabase();
  if (workers) {
    let client = workerClients.get(workers.scope);
    if (!client) {
      client = createClient(workers.connectionString);
      workerClients.set(workers.scope, client);
    }
    return client;
  }
  // A production build can bundle the generated client into several chunks, each with its own
  // PrismaClient class. Each class keeps its own client; none may close another's pool while
  // its queries run ("Cannot use a pool after calling end on the pool").
  if (process.env.NODE_ENV === "production") {
    globalForPrisma.clients ??= new Map();
    let client = globalForPrisma.clients.get(PrismaClient);
    if (!client) {
      client = createClient(process.env.DATABASE_URL);
      globalForPrisma.clients.set(PrismaClient, client);
    }
    return client;
  }
  // Reuse clients across hot reloads in development, one per PrismaClient class. After `prisma
  // generate` the dev server reloads this module with a new class; a client made from the old
  // class would not know new fields ("Unknown field …"), so the new class gets its own client.
  // The dev server can also load several chunks at once, each with its own class, so an old
  // client is never closed here: closing it would break another chunk's queries in flight
  // ("Cannot use a pool after calling end on the pool"). Idle connections close on their own.
  globalForPrisma.clients ??= new Map();
  let client = globalForPrisma.clients.get(PrismaClient);
  if (!client) {
    client = createClient(process.env.DATABASE_URL);
    globalForPrisma.clients.set(PrismaClient, client);
  }
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
