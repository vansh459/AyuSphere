/**
 * CLI entry: `pnpm db:seed:real` — inserts real CTRI registry metadata
 * (synthetic participants only) into the Neon database in DATABASE_URL.
 * Idempotent: existing ctriNumbers are skipped, nothing is deleted.
 */
import dns from "node:dns";

// Windows getaddrinfo intermittently ENOTFOUNDs the Neon pooler host even
// though direct DNS queries succeed — route lookups through resolve4.
// (Same monkeypatch as scripts/backfill-templates.ts.)
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

import { createDb } from "@/db";
import { seedReal } from "@/db/seed-real";

async function main() {
  const db = createDb();
  const summary = await seedReal(db);
  console.log("Real-registry seed complete:", summary);
  process.exit(0);
}

main().catch((err) => {
  console.error("Real-registry seed failed:", err);
  process.exit(1);
});
