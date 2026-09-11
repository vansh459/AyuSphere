/** Site registry + trial-site activation (workflow.md §3). */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { sites, trialSites } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";

export const createSiteInput = z.object({
  name: z.string().min(2),
  city: z.string().min(2),
  state: z.string().min(2),
  piUserId: z.string().uuid().optional(),
});

export async function createSite(
  db: Db,
  actor: Actor,
  input: z.infer<typeof createSiteInput>,
) {
  assertCan(actor.role, "site.manage");
  const data = createSiteInput.parse(input);
  return withAudit(db, actor, "site.create", async (tx) => {
    const [site] = await tx.insert(sites).values(data).returning();
    return {
      result: site,
      entityType: "site",
      entityId: site.id,
      after: { name: site.name, city: site.city },
    };
  });
}

export const attachSiteInput = z.object({
  trialId: z.string().uuid(),
  siteId: z.string().uuid(),
  enrollmentTarget: z.number().int().min(0),
});

export async function attachSiteToTrial(
  db: Db,
  actor: Actor,
  input: z.infer<typeof attachSiteInput>,
) {
  assertCan(actor.role, "site.manage");
  const data = attachSiteInput.parse(input);
  const [existing] = await db
    .select({ id: trialSites.id })
    .from(trialSites)
    .where(
      and(
        eq(trialSites.trialId, data.trialId),
        eq(trialSites.siteId, data.siteId),
      ),
    )
    .limit(1);
  if (existing) {
    throw new Error(
      "This site is already attached to that trial — adjust its target or activation instead.",
    );
  }
  return withAudit(db, actor, "site.attach", async (tx) => {
    const [ts] = await tx.insert(trialSites).values(data).returning();
    return {
      result: ts,
      entityType: "trial_site",
      entityId: ts.id,
      after: {
        trialId: ts.trialId,
        siteId: ts.siteId,
        activationStatus: ts.activationStatus,
      },
    };
  });
}

export async function activateTrialSite(
  db: Db,
  actor: Actor,
  trialSiteId: string,
) {
  assertCan(actor.role, "site.manage");
  const [existing] = await db
    .select()
    .from(trialSites)
    .where(eq(trialSites.id, trialSiteId))
    .limit(1);
  if (!existing) throw new Error("trial site not found");
  return withAudit(db, actor, "site.activate", async (tx) => {
    const [updated] = await tx
      .update(trialSites)
      .set({ activationStatus: "active", activatedAt: new Date() })
      .where(
        and(
          eq(trialSites.id, trialSiteId),
          eq(trialSites.activationStatus, "pending"),
        ),
      )
      .returning();
    if (!updated) throw new Error("trial site is not pending activation");
    return {
      result: updated,
      entityType: "trial_site",
      entityId: trialSiteId,
      before: { activationStatus: existing.activationStatus },
      after: {
        activationStatus: "active",
        activatedAt: updated.activatedAt?.toISOString(),
      },
    };
  });
}
