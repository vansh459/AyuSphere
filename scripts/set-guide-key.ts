/** One-off: store the Groq guide key via the audited settings service.
 * Usage: GROQ_SET_KEY=... GROQ_SET_MODEL=... npx tsx scripts/set-guide-key.ts */
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
import { saveGuideSettings } from "@/services/settings";

async function main() {
  const apiKey = process.env.GROQ_SET_KEY;
  if (!apiKey) throw new Error("GROQ_SET_KEY not provided");
  const db = createDb();
  const r = (await db.execute(
    sql`select id from users where role = 'admin' limit 1`,
  )) as unknown as { rows: { id: string }[] };
  const saved = await saveGuideSettings(
    db,
    { id: r.rows[0].id, role: "admin" },
    { model: process.env.GROQ_SET_MODEL ?? "llama-3.3-70b-versatile", apiKey },
  );
  console.log("guide settings saved:", saved.model);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
