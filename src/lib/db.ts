/**
 * Database connection.
 *
 * The client is created on FIRST USE rather than at import time. Connecting
 * eagerly makes `next build` fail with a confusing error whenever
 * DATABASE_URL isn't present in the build environment, even though nothing
 * is actually querying yet. Lazy means a missing variable surfaces as a
 * clear runtime error from the request that needed it.
 *
 * Next.js also hot-reloads modules in development, which would otherwise
 * open a new Postgres pool on every save until the database refuses
 * connections. Caching on `globalThis` keeps exactly one pool alive.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __sitegradeClient?: ReturnType<typeof postgres>;
  __sitegradeDb?: Db;
};

function connect(): Db {
  if (globalForDb.__sitegradeDb) return globalForDb.__sitegradeDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in, or add it to your Vercel project's environment variables.",
    );
  }

  // `prepare: false` is required by connection poolers (Neon, Supabase, PgBouncer).
  const client =
    globalForDb.__sitegradeClient ?? postgres(connectionString, { prepare: false });

  const instance = drizzle(client, { schema });

  // Cached in EVERY environment, production included.
  //
  // This used to be guarded by `NODE_ENV !== "production"`, on the usual
  // reasoning that the global cache is only there to survive hot reloads.
  // That was badly wrong here: `db` below is a Proxy that calls connect() on
  // every property read, so without the cache each `db.query…` opened a
  // brand-new Postgres pool. One dashboard render touches `db` half a dozen
  // times, and a serverless host keeps the instance warm — so a few dozen
  // page views exhausted the connection limit and every page started
  // throwing, with nothing short of a redeploy to clear it.
  globalForDb.__sitegradeClient = client;
  globalForDb.__sitegradeDb = instance;

  return instance;
}

/**
 * Behaves exactly like a Drizzle instance, but defers connecting until the
 * first property is read — so every existing `db.query...` call site is
 * unchanged.
 */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver);
  },
});
