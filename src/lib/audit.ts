/**
 * withAudit — ALCOA+ core (D-010).
 * Every service mutation runs inside a transaction that ALSO inserts the
 * audit event: an unaudited write cannot commit, and a failed write leaves
 * no audit noise. `audit_events` is insert-only at the database level.
 */
import type { Db, Tx } from "@/db";
import { auditEvents } from "@/db/schema";
import type { Role } from "@/lib/rbac";

export type Actor = {
  id: string;
  role: Role;
};

export type AuditedResult<T> = {
  result: T;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

export async function withAudit<T>(
  db: Db,
  actor: Actor,
  action: string,
  run: (tx: Tx) => Promise<AuditedResult<T>>,
  requestId?: string,
): Promise<T> {
  return db.transaction(async (tx) => {
    const { result, entityType, entityId, before, after } = await run(tx);
    await tx.insert(auditEvents).values({
      actorId: actor.id,
      actorRole: actor.role,
      action,
      entityType,
      entityId,
      before: before ?? null,
      after: after ?? null,
      requestId: requestId ?? null,
    });
    return result;
  });
}

/** system-attributed actor for cron/rule writes (visit sweeps etc.) */
export const SYSTEM_ACTOR: Actor = {
  // fixed nil UUID: audit rows must always be attributable (ALCOA "A")
  id: "00000000-0000-0000-0000-000000000000",
  role: "admin",
};
