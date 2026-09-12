/**
 * T10.1 — Data-query management.
 * Gate: the raise → answer → close walk is fully audited; an OPEN query
 * blocks CRF approval until answered; RBAC is enforced on both sides
 * (coordinator cannot raise/close, monitor cannot answer); query stats
 * count statuses and cycle time.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  auditEvents,
  crfEntries,
  crfTemplates,
  dataQueries,
  participants,
  sites,
  trialSites,
  trials,
  users,
  visits,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { hashPassword } from "@/lib/auth-core";
import { RbacError } from "@/lib/rbac";
import type { CrfField } from "@/lib/crf";
import { CrfError, approveEntry, createDraftEntry, submitEntry } from "@/services/crf";
import {
  DataQueryError,
  answerQuery,
  closeQuery,
  hasOpenQuery,
  listQueries,
  queriesForEntries,
  queryStats,
  raiseQuery,
} from "@/services/data-queries";

const FIELDS: CrfField[] = [
  { name: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", min: 70, max: 250, required: true, cdashVar: "VSORRES_SYSBP" },
];

const PW = "Sign@1234";

let db: TestDb;
let monitor: Actor, coordinator: Actor, pi: Actor;
let entryId: string;

beforeAll(async () => {
  db = await createTestDb();
  const hash = await hashPassword(PW);
  const rows = await db
    .insert(users)
    .values([
      { email: "mo@q.demo", passwordHash: hash, name: "MO", role: "monitor" },
      { email: "co@q.demo", passwordHash: hash, name: "CO", role: "coordinator" },
      { email: "pi@q.demo", passwordHash: hash, name: "PI", role: "pi" },
    ])
    .returning();
  monitor = { id: rows[0].id, role: "monitor" };
  coordinator = { id: rows[1].id, role: "coordinator" };
  pi = { id: rows[2].id, role: "pi" };

  const [trial] = await db
    .insert(trials)
    .values({
      protocolCode: "AYU-DQ",
      title: "Query fixture",
      studyType: "interventional",
      intervention: "X",
      targetEnrollment: 5,
      status: "active",
      createdBy: pi.id,
    })
    .returning();
  const [site] = await db
    .insert(sites)
    .values({ name: "S", city: "C", state: "ST" })
    .returning();
  const [ts] = await db
    .insert(trialSites)
    .values({ trialId: trial.id, siteId: site.id, activationStatus: "active" })
    .returning();
  const [p] = await db
    .insert(participants)
    .values({ subjectCode: "AYU-DQ-P-0001", trialSiteId: ts.id })
    .returning();
  const [template] = await db
    .insert(crfTemplates)
    .values({
      trialId: trial.id,
      visitType: "Baseline",
      name: "Baseline CRF",
      fields: FIELDS,
    })
    .returning();
  const now = Date.now();
  const [visit] = await db
    .insert(visits)
    .values({
      participantId: p.id,
      templateId: template.id,
      visitNumber: 1,
      name: "Baseline",
      scheduledDate: new Date(now),
      windowStart: new Date(now - 86_400_000),
      windowEnd: new Date(now + 86_400_000),
      status: "due",
    })
    .returning();

  const draft = await createDraftEntry(db, coordinator, visit.id, { sbp: 128 });
  const submitted = await submitEntry(db, coordinator, draft.id);
  entryId = submitted.id;
});

describe("T10.1 — RBAC on both sides of the loop", () => {
  it("coordinator cannot raise or close; monitor cannot answer", async () => {
    await expect(
      raiseQuery(db, coordinator, { crfEntryId: entryId, question: "why is this?" }),
    ).rejects.toThrow(RbacError);
    await expect(
      closeQuery(db, coordinator, "00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow(RbacError);
    await expect(
      answerQuery(db, monitor, "00000000-0000-4000-8000-000000000001", "self-answer"),
    ).rejects.toThrow(RbacError);
  });
});

describe("T10.1 — raise → block approval → answer → approve → close", () => {
  it("an open query blocks SIGNED approval until answered", async () => {
    const query = await raiseQuery(db, monitor, {
      crfEntryId: entryId,
      question: "SBP 128 conflicts with the source note — please verify",
    });
    expect(query.status).toBe("open");
    expect(await hasOpenQuery(db, entryId)).toBe(true);

    // approval refused BEFORE the signature is even checked
    await expect(
      approveEntry(db, pi, entryId, { password: PW }),
    ).rejects.toThrow(/open data query/);
    const [still] = await db
      .select()
      .from(crfEntries)
      .where(eq(crfEntries.id, entryId));
    expect(still.status).toBe("submitted");

    // coordinator answers; the thread records author + body
    const answered = await answerQuery(
      db,
      coordinator,
      query.id,
      "Verified against the note — 128 is correct.",
    );
    expect(answered.status).toBe("answered");
    expect(await hasOpenQuery(db, entryId)).toBe(false);
    const [withThread] = await queriesForEntries(db, [entryId]);
    expect(withThread.thread).toHaveLength(1);
    expect(withThread.thread[0].authorRole).toBe("coordinator");

    // answered ⇒ approval proceeds (signed)
    const approved = await approveEntry(db, pi, entryId, { password: PW });
    expect(approved.status).toBe("approved");

    // monitor closes with a resolution note (second thread message)
    const closed = await closeQuery(db, monitor, query.id, "resolved — no correction needed");
    expect(closed.status).toBe("closed");
    expect(closed.closedBy).toBe(monitor.id);

    // cannot answer or re-close a closed query
    await expect(
      answerQuery(db, coordinator, query.id, "late answer"),
    ).rejects.toThrow(DataQueryError);
    await expect(closeQuery(db, monitor, query.id)).rejects.toThrow(
      /already closed/,
    );

    // the whole walk is audited
    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, query.id));
    expect(audit.map((a) => a.action).sort()).toEqual([
      "data_query.answer",
      "data_query.close",
      "data_query.raise",
    ]);
  });

  it("queries on unknown or superseded entries are refused", async () => {
    await expect(
      raiseQuery(db, monitor, {
        crfEntryId: "00000000-0000-4000-8000-000000000002",
        question: "ghost entry?",
      }),
    ).rejects.toThrow(DataQueryError);

    await db
      .update(crfEntries)
      .set({ status: "superseded" })
      .where(eq(crfEntries.id, entryId));
    await expect(
      raiseQuery(db, monitor, { crfEntryId: entryId, question: "old version?" }),
    ).rejects.toThrow(/superseded/);
    await db
      .update(crfEntries)
      .set({ status: "approved" })
      .where(eq(crfEntries.id, entryId));
  });

  it("stats count statuses and median cycle time; listing carries labels", async () => {
    const stats = await queryStats(db);
    expect(stats.open).toBe(0);
    expect(stats.answered).toBe(0);
    expect(stats.closed).toBe(1);
    expect(stats.medianCycleDays).not.toBeNull();
    expect(stats.medianCycleDays!).toBeGreaterThanOrEqual(0);

    const [row] = await listQueries(db);
    expect(row.subjectCode).toBe("AYU-DQ-P-0001");
    expect(row.visitName).toBe("Baseline");
    expect(row.query.status).toBe("closed");
  });
});
