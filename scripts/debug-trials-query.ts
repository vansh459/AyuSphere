/** Quick prod-DB check: runs the trials list query against DATABASE_URL. */
import { createDb } from "@/db";
import { listTrialsWithCounts } from "@/services/trials";

async function main() {
  const db = createDb();
  try {
    const rows = await listTrialsWithCounts(db);
    console.log(
      "OK — rows:",
      rows.length,
      rows.map((r) => `${r.trial.protocolCode}: ${r.enrolled} enrolled, ${r.siteCount} sites`),
    );
  } catch (e) {
    console.error("QUERY FAILED:", e);
    process.exit(1);
  }
  process.exit(0);
}
void main();
