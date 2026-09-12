/**
 * Data-query management (T10.1, gap-analysis G6) — the PS's "data-query
 * status" as a human loop: a monitor raises a query on a CRF entry,
 * data-entry roles (coordinator/PI) answer, the monitor closes. An OPEN
 * query blocks the entry's approval (enforced in the CRF service). Every
 * step is audited.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import {
  crfEntries,
  dataQueries,
  dataQueryMessages,
  participants,
  trialSites,
  visits,
} from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";

export class DataQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataQueryError";
  }
}

export const raiseQueryInput = z.object({
  crfEntryId: z.string().uuid(),
  question: z.string().min(5),
});

export async function raiseQuery(
  db: Db,
  actor: Actor,
  input: z.infer<typeof raiseQueryInput>,
) {
  assertCan(actor.role, "query.manage");
  const data = raiseQueryInput.parse(input);
  const [entry] = await db
    .select()
    .from(crfEntries)
    .where(eq(crfEntries.id, data.crfEntryId))
    .limit(1);
  if (!entry) throw new DataQueryError("CRF entry not found");
  if (entry.status === "superseded") {
    throw new DataQueryError(
      "entry has been superseded — query the current version",
    );
  }

  return withAudit(db, actor, "data_query.raise", async (tx) => {
    const [query] = await tx
      .insert(dataQueries)
      .values({
        crfEntryId: data.crfEntryId,
        question: data.question,
        raisedBy: actor.id,
      })
      .returning();
    return {
      result: query,
      entityType: "data_query",
      entityId: query.id,
      after: { crfEntryId: data.crfEntryId, question: data.question },
    };
  });
}

export async function answerQuery(
  db: Db,
  actor: Actor,
  queryId: string,
  body: string,
) {
  assertCan(actor.role, "crf.enter");
  if (body.trim().length < 2) {
    throw new DataQueryError("an answer is required");
  }
  const [query] = await db
    .select()
    .from(dataQueries)
    .where(eq(dataQueries.id, queryId))
    .limit(1);
  if (!query) throw new DataQueryError("query not found");
  if (query.status !== "open") {
    throw new DataQueryError(`cannot answer a query in status '${query.status}'`);
  }

  return withAudit(db, actor, "data_query.answer", async (tx) => {
    await tx.insert(dataQueryMessages).values({
      queryId,
      authorId: actor.id,
      authorRole: actor.role,
      body: body.trim(),
    });
    const [updated] = await tx
      .update(dataQueries)
      .set({ status: "answered", answeredAt: new Date() })
      .where(eq(dataQueries.id, queryId))
      .returning();
    return {
      result: updated,
      entityType: "data_query",
      entityId: queryId,
      before: { status: "open" },
      after: { status: "answered" },
    };
  });
}

export async function closeQuery(
  db: Db,
  actor: Actor,
  queryId: string,
  note?: string,
) {
  assertCan(actor.role, "query.manage");
  const [query] = await db
    .select()
    .from(dataQueries)
    .where(eq(dataQueries.id, queryId))
    .limit(1);
  if (!query) throw new DataQueryError("query not found");
  if (query.status === "closed") {
    throw new DataQueryError("query is already closed");
  }

  return withAudit(db, actor, "data_query.close", async (tx) => {
    if (note?.trim()) {
      await tx.insert(dataQueryMessages).values({
        queryId,
        authorId: actor.id,
        authorRole: actor.role,
        body: note.trim(),
      });
    }
    const [updated] = await tx
      .update(dataQueries)
      .set({ status: "closed", closedBy: actor.id, closedAt: new Date() })
      .where(eq(dataQueries.id, queryId))
      .returning();
    return {
      result: updated,
      entityType: "data_query",
      entityId: queryId,
      before: { status: query.status },
      after: { status: "closed" },
    };
  });
}

/** true when the entry has a query still awaiting an answer */
export async function hasOpenQuery(db: Db, crfEntryId: string): Promise<boolean> {
  const rows = await db
    .select({ id: dataQueries.id })
    .from(dataQueries)
    .where(
      and(eq(dataQueries.crfEntryId, crfEntryId), eq(dataQueries.status, "open")),
    )
    .limit(1);
  return rows.length > 0;
}

/** queries + thread for a set of entries — drives the visit-page panel */
export async function queriesForEntries(db: Db, entryIds: string[]) {
  if (entryIds.length === 0) return [];
  const queries = await db
    .select()
    .from(dataQueries)
    .where(inArray(dataQueries.crfEntryId, entryIds))
    .orderBy(desc(dataQueries.createdAt));
  const messages = queries.length
    ? await db
        .select()
        .from(dataQueryMessages)
        .where(
          inArray(
            dataQueryMessages.queryId,
            queries.map((q) => q.id),
          ),
        )
        .orderBy(dataQueryMessages.at)
    : [];
  return queries.map((q) => ({
    ...q,
    thread: messages.filter((m) => m.queryId === q.id),
  }));
}

/** recent queries with subject/visit labels — the monitoring-page list */
export async function listQueries(db: Db, limit = 50) {
  return db
    .select({
      query: dataQueries,
      subjectCode: participants.subjectCode,
      visitName: visits.name,
      trialId: trialSites.trialId,
    })
    .from(dataQueries)
    .innerJoin(crfEntries, eq(dataQueries.crfEntryId, crfEntries.id))
    .innerJoin(visits, eq(crfEntries.visitId, visits.id))
    .innerJoin(participants, eq(visits.participantId, participants.id))
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .orderBy(desc(dataQueries.createdAt))
    .limit(limit);
}

/** recent queryable entries with labels — the raise form's picker */
export async function listQueryableEntries(db: Db, limit = 100) {
  return db
    .select({
      entryId: crfEntries.id,
      status: crfEntries.status,
      subjectCode: participants.subjectCode,
      visitName: visits.name,
    })
    .from(crfEntries)
    .innerJoin(visits, eq(crfEntries.visitId, visits.id))
    .innerJoin(participants, eq(visits.participantId, participants.id))
    .where(inArray(crfEntries.status, ["draft", "submitted", "approved"]))
    .orderBy(desc(crfEntries.createdAt))
    .limit(limit);
}

export type QueryStats = {
  open: number;
  answered: number;
  closed: number;
  /** median days from raise to close, over closed queries */
  medianCycleDays: number | null;
};

export async function queryStats(db: Db): Promise<QueryStats> {
  const rows = await db
    .select({
      status: dataQueries.status,
      createdAt: dataQueries.createdAt,
      closedAt: dataQueries.closedAt,
    })
    .from(dataQueries);
  const byStatus = { open: 0, answered: 0, closed: 0 };
  const cycles: number[] = [];
  for (const r of rows) {
    byStatus[r.status] += 1;
    if (r.status === "closed" && r.closedAt) {
      cycles.push(
        (r.closedAt.getTime() - r.createdAt.getTime()) / 86_400_000,
      );
    }
  }
  cycles.sort((a, b) => a - b);
  const median =
    cycles.length === 0
      ? null
      : cycles.length % 2 === 1
        ? cycles[(cycles.length - 1) / 2]
        : (cycles[cycles.length / 2 - 1] + cycles[cycles.length / 2]) / 2;
  return {
    ...byStatus,
    medianCycleDays: median === null ? null : Math.round(median * 10) / 10,
  };
}
