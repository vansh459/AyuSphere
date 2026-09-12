/** Removes demo/test trials and all dependents; keeps CTRI-scraped data,
 * users, AI settings, and the append-only audit trail. */
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
import { sweepAlerts } from "@/services/alerts";

async function main() {
  const db = createDb();
  const run = async (q: ReturnType<typeof sql>) =>
    ((await db.execute(q)) as unknown as { rows: Record<string, unknown>[] }).rows;

  const demo = await run(
    sql`select id, protocol_code from trials where protocol_code not ilike 'CTRI-%'`,
  );
  console.log("demo trials to remove:", demo.map((d) => d.protocol_code));
  if (demo.length === 0) { console.log("nothing to do"); process.exit(0); }

  await db.transaction(async (tx) => {
    const t = sql`select id from trials where protocol_code not ilike 'CTRI-%'`;
    const ts = sql`select id from trial_sites where trial_id in (${t})`;
    const p = sql`select id from participants where trial_site_id in (${ts})`;
    const v = sql`select id from visits where participant_id in (${p})`;
    await tx.execute(sql`delete from alerts`);
    await tx.execute(sql`delete from ae_actions where ae_id in (select id from adverse_events where participant_id in (${p}))`);
    await tx.execute(sql`delete from adverse_events where participant_id in (${p})`);
    await tx.execute(sql`delete from crf_entries where visit_id in (${v})`);
    await tx.execute(sql`delete from extractions where visit_id in (${v})`);
    await tx.execute(sql`delete from visits where id in (${v})`);
    await tx.execute(sql`delete from participants where id in (${p})`);
    await tx.execute(sql`delete from documents where trial_id in (${t})`);
    await tx.execute(sql`delete from milestones where trial_id in (${t})`);
    await tx.execute(sql`delete from crf_templates where trial_id in (${t})`);
    await tx.execute(sql`delete from trial_sites where id in (${ts})`);
    await tx.execute(sql`delete from trials where protocol_code not ilike 'CTRI-%'`);
    await tx.execute(sql`delete from sites where id not in (select site_id from trial_sites)`);
  });

  await sweepAlerts(db); // regenerate alerts for the remaining real data
  for (const table of ["trials", "sites", "participants", "visits", "adverse_events", "alerts"]) {
    const [{ n }] = await run(sql`select count(*)::int as n from ${sql.raw(table)}`);
    console.log(table, n);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
