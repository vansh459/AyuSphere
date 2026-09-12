/**
 * CLI entry: `pnpm db:migrate` — applies drizzle/ migrations to the Neon
 * database in DATABASE_URL using the app's own driver (drizzle-kit migrate
 * can't take the Windows DNS workaround below, and drizzle.config.ts loads
 * no env files). Compatible with drizzle-kit's journal + migrations table.
 */
import { readFileSync } from "node:fs";
import dns from "node:dns";
import path from "node:path";

// .env.local wins over .env; neither overrides variables already in the shell
for (const file of [".env.local", ".env"]) {
  try {
    const text = readFileSync(path.resolve(process.cwd(), file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      process.env[m[1]] ??= value;
    }
  } catch {
    // file absent — fine
  }
}

// Windows getaddrinfo intermittently ENOTFOUNDs the Neon pooler host even
// though direct DNS queries succeed — route lookups through resolve4.
// (Same monkeypatch as src/db/run-seed-real.ts.)
const originalLookup = dns.lookup.bind(dns);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(dns as any).lookup = (hostname: string, options: any, callback?: any) => {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  dns.resolve4(hostname, (err, addresses) => {
    if (err || !addresses?.length) {
      return originalLookup(hostname, options, callback);
    }
    if (options?.all) {
      callback(null, addresses.map((address) => ({ address, family: 4 })));
    } else {
      callback(null, addresses[0], 4);
    }
  });
};

import { migrate } from "drizzle-orm/neon-serverless/migrator";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { createDb, type schema } from "@/db";

async function main() {
  // createDb returns the driver-agnostic Db; underneath it IS the
  // neon-serverless driver, which the migrator requires
  const db = createDb() as unknown as NeonDatabase<typeof schema>;
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  console.log("Migrations applied.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
