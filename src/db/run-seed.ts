/** CLI entry: `pnpm db:seed` — seeds the Neon database in DATABASE_URL. */
import { createDb } from "@/db";
import { seed } from "@/db/seed";

async function main() {
  const db = createDb();
  const summary = await seed(db);
  console.log("Seed complete:", summary);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
