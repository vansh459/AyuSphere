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
  const r = (await createDb().execute(
    sql`select id from users where role = 'admin' limit 1`,
  )) as unknown as { rows: { id: string }[] };
  console.log("ADMIN=" + r.rows[0].id);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
