import dns from "node:dns";
const ol = dns.lookup.bind(dns);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(dns as any).lookup = (h: string, o: any, cb?: any) => {
  if (typeof o === "function") { cb = o; o = {}; }
  dns.resolve4(h, (e, a) => {
    if (e || !a?.length) return ol(h, o, cb);
    if (o?.all) cb(null, a.map((address) => ({ address, family: 4 })));
    else cb(null, a[0], 4);
  });
};
import { sql } from "drizzle-orm";
import { createDb } from "@/db";

async function main() {
  const db = createDb();
  const t = (await db.execute(
    sql`select id, protocol_code, title, status from trials order by created_at desc limit 6`,
  )) as unknown as { rows: Record<string, unknown>[] };
  for (const row of t.rows) {
    const d = (await db.execute(
      sql`select kind, title, version from documents where trial_id = ${row.id}`,
    )) as unknown as { rows: Record<string, unknown>[] };
    console.log(row.protocol_code, `[${row.status}]`, "docs:", JSON.stringify(d.rows));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
