import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  auditEvents,
  documents,
  milestones,
  sites,
  trialSites,
  trials,
  users,
} from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import {
  TransitionError,
  createTrial,
  transitionTrial,
} from "@/services/trials";

let db: TestDb;
let pi: Actor, coordinator: Actor, ethics: Actor, monitor: Actor;

const INPUT = {
  protocolCode: "AYU-100",
  title: "Guduchi in Recurrent Fever — Pilot Study",
  studyType: "interventional" as const,
  intervention: "Guduchi extract",
  targetEnrollment: 60,
  visitPlan: [
    { visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 },
    { visitNumber: 2, name: "Week 4", dayOffset: 28, windowDays: 7 },
  ],
};

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values(
      (["pi", "coordinator", "ethics", "monitor"] as const).map((role) => ({
        email: `${role}@t.demo`,
        passwordHash: "x",
        name: role,
        role,
      })),
    )
    .returning();
  const actor = (role: string): Actor => {
    const u = rows.find((r) => r.role === role)!;
    return { id: u.id, role: u.role };
  };
  pi = actor("pi");
  coordinator = actor("coordinator");
  ethics = actor("ethics");
  monitor = actor("monitor");
});

describe("T1.2 — withAudit atomicity (D-010)", () => {
  it("a failing action writes neither domain rows nor audit rows", async () => {
    await expect(
      withAudit(db, pi, "trial.create", async (tx) => {
        await tx.insert(trials).values({
          protocolCode: "AYU-DOOMED",
          title: "will roll back",
          studyType: "interventional",
          intervention: "x",
          targetEnrollment: 10,
          createdBy: pi.id,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const ghosts = await db
      .select()
      .from(trials)
      .where(eq(trials.protocolCode, "AYU-DOOMED"));
    expect(ghosts).toHaveLength(0);
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "trial.create"));
    expect(audits).toHaveLength(0);
  });
});

describe("T1.2 — trial creation", () => {
  it("creates trial + scaffolds 3 regulatory milestones + audit row atomically", async () => {
    const trial = await createTrial(db, coordinator, INPUT);
    expect(trial.status).toBe("draft");

    const ms = await db
      .select()
      .from(milestones)
      .where(eq(milestones.trialId, trial.id));
    expect(ms.map((m) => m.kind).sort()).toEqual([
      "ctri_registration",
      "iec_approval",
      "iec_submission",
    ]);

    const audit = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "trial.create"),
          eq(auditEvents.entityId, trial.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].actorRole).toBe("coordinator");
  });

  it("monitor cannot create trials (RBAC) and nothing is written", async () => {
    await expect(
      createTrial(db, monitor, { ...INPUT, protocolCode: "AYU-101" }),
    ).rejects.toThrow(RbacError);
    const rows = await db
      .select()
      .from(trials)
      .where(eq(trials.protocolCode, "AYU-101"));
    expect(rows).toHaveLength(0);
  });

  it("rejects invalid input via Zod", async () => {
    await expect(
      createTrial(db, pi, { ...INPUT, protocolCode: "AYU-102", visitPlan: [] }),
    ).rejects.toThrow();
  });
});

describe("T1.2 — lifecycle transitions through the service", () => {
  it("walks draft → active with every gate enforced", async () => {
    const trial = await createTrial(db, pi, {
      ...INPUT,
      protocolCode: "AYU-200",
    });

    // gate: no protocol document yet
    await expect(
      transitionTrial(db, pi, trial.id, "iec_review"),
    ).rejects.toThrow(TransitionError);

    await db.insert(documents).values({
      trialId: trial.id,
      kind: "protocol",
      title: "Protocol v1",
      blobUrl: "blob://protocol-v1",
      uploadedBy: pi.id,
    });
    await transitionTrial(db, pi, trial.id, "iec_review");

    // gate: only ethics may approve
    await expect(
      transitionTrial(db, coordinator, trial.id, "iec_approved"),
    ).rejects.toThrow(RbacError);
    await transitionTrial(db, ethics, trial.id, "iec_approved");

    // gate: CTRI number required
    await expect(
      transitionTrial(db, coordinator, trial.id, "ctri_registered"),
    ).rejects.toThrow(TransitionError);
    await transitionTrial(db, coordinator, trial.id, "ctri_registered", {
      ctriNumber: "CTRI/2026/09/099999",
    });

    // gate: needs an active site
    await expect(
      transitionTrial(db, pi, trial.id, "active"),
    ).rejects.toThrow(TransitionError);
    const [site] = await db
      .insert(sites)
      .values({ name: "AIIA Delhi", city: "New Delhi", state: "DL" })
      .returning();
    await db.insert(trialSites).values({
      trialId: trial.id,
      siteId: site.id,
      activationStatus: "active",
      activatedAt: new Date(),
      enrollmentTarget: 30,
    });
    const active = await transitionTrial(db, pi, trial.id, "active");
    expect(active.status).toBe("active");
    expect(active.ctriNumber).toBe("CTRI/2026/09/099999");

    // milestones completed along the way
    const ms = await db
      .select()
      .from(milestones)
      .where(eq(milestones.trialId, trial.id));
    for (const kind of [
      "iec_submission",
      "iec_approval",
      "ctri_registration",
    ]) {
      expect(
        ms.find((m) => m.kind === kind)?.completedAt,
        `${kind} milestone should be completed`,
      ).toBeTruthy();
    }

    // every transition audited with before/after
    const audit = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "trial.transition"),
          eq(auditEvents.entityId, trial.id),
        ),
      );
    expect(audit.length).toBe(4);
    const approval = audit.find(
      (a) => (a.after as { status: string }).status === "iec_approved",
    );
    expect(approval?.actorRole).toBe("ethics");
    expect((approval?.before as { status: string }).status).toBe("iec_review");
  });

  it("rejects an illegal jump (draft → active) and leaves no audit row", async () => {
    const trial = await createTrial(db, pi, {
      ...INPUT,
      protocolCode: "AYU-201",
    });
    await expect(
      transitionTrial(db, pi, trial.id, "active"),
    ).rejects.toThrow(TransitionError);
    const audit = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "trial.transition"),
          eq(auditEvents.entityId, trial.id),
        ),
      );
    expect(audit).toHaveLength(0);
  });
});
