/** Audit browser queries (workflow.md §13) — audit.view roles only. */
import { and, desc, eq, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { auditEvents } from "@/db/schema";
import { assertCan } from "@/lib/rbac";
import type { Actor } from "@/lib/audit";

export type AuditFilters = {
  entityType?: string;
  entityId?: string;
  actorRole?: string;
  action?: string;
  limit?: number;
};

export async function getAuditTrail(
  db: Db,
  actor: Actor,
  filters: AuditFilters = {},
) {
  assertCan(actor.role, "audit.view");
  const conds: SQL[] = [];
  if (filters.entityType) conds.push(eq(auditEvents.entityType, filters.entityType));
  if (filters.entityId) conds.push(eq(auditEvents.entityId, filters.entityId));
  if (filters.actorRole) conds.push(eq(auditEvents.actorRole, filters.actorRole));
  if (filters.action) conds.push(eq(auditEvents.action, filters.action));
  return db
    .select()
    .from(auditEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditEvents.at))
    .limit(Math.min(filters.limit ?? 100, 500));
}
