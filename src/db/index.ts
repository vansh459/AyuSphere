import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";

/**
 * Driver-agnostic database type: satisfied by the Neon serverless driver
 * (production) and by PGlite (tests, D-019). Services depend on this type,
 * never on a concrete driver.
 */
export type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** transaction handle passed to withAudit callbacks */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  // neon-serverless (WebSocket Pool) — supports interactive transactions,
  // which withAudit (D-010) requires; neon-http does not.
  const pool = new Pool({ connectionString: url });
  return drizzle(pool, { schema }) as unknown as Db;
}

let _db: Db | undefined;

export function getDb(): Db {
  _db ??= createDb();
  return _db;
}

export { schema };
