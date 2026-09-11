/**
 * One-off backfill (browser-test finding, 2026-09-11): trials created via
 * the UI before createTrial scaffolded CRF templates have template-less
 * visits. Creates default templates for such trials and links their visits.
 * Usage: DATABASE_URL=... npx tsx scripts/backfill-templates.ts
 */
import dns from "node:dns";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createDb } from "@/db";
import { crfTemplates, participants, trialSites, trials, visits } from "@/db/schema";
import { DEFAULT_CRF_FIELDS } from "@/lib/crf";

// Windows getaddrinfo intermittently ENOTFOUNDs the Neon pooler host even
// though direct DNS queries succeed — route lookups through resolve4.
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

type PlanItem = { name: string };

async function main() {
  const db = createDb();
  const allTrials = await db.select().from(trials);
  let created = 0;
  let linked = 0;

  for (const trial of allTrials) {
    const existing = await db
      .select()
      .from(crfTemplates)
      .where(eq(crfTemplates.trialId, trial.id));
    const have = new Set(existing.map((t) => t.visitType));
    const plan = (trial.visitPlan as PlanItem[]) ?? [];

    for (const v of plan) {
      if (have.has(v.name)) continue;
      await db.insert(crfTemplates).values({
        trialId: trial.id,
        visitType: v.name,
        name: `${trial.protocolCode} — ${v.name} CRF`,
        fields: DEFAULT_CRF_FIELDS,
      });
      created += 1;
      console.log(`created template: ${trial.protocolCode} / ${v.name}`);
    }

    // link this trial's template-less visits by visit name
    const templates = await db
      .select()
      .from(crfTemplates)
      .where(eq(crfTemplates.trialId, trial.id));
    const tsRows = await db
      .select({ id: trialSites.id })
      .from(trialSites)
      .where(eq(trialSites.trialId, trial.id));
    if (tsRows.length === 0) continue;
    const parts = await db
      .select({ id: participants.id })
      .from(participants)
      .where(inArray(participants.trialSiteId, tsRows.map((r) => r.id)));
    if (parts.length === 0) continue;
    const orphanVisits = await db
      .select()
      .from(visits)
      .where(
        and(
          inArray(visits.participantId, parts.map((p) => p.id)),
          isNull(visits.templateId),
        ),
      );
    for (const v of orphanVisits) {
      const template = templates.find((t) => t.visitType === v.name);
      if (!template) continue;
      await db
        .update(visits)
        .set({ templateId: template.id })
        .where(eq(visits.id, v.id));
      linked += 1;
    }
  }
  console.log(`done — templates created: ${created}, visits linked: ${linked}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
