/**
 * Test database: PGlite — real in-process Postgres, no Docker (D-019).
 * Each call returns a fresh, fully migrated database.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "@/db/schema";
import type { Db } from "@/db";

export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../drizzle"),
  });
  return db as unknown as Db;
}

export type TestDb = Db;
