import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { auditEvents, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import { createTrial } from "@/services/trials";
import {
  activateTrialSite,
  attachSiteToTrial,
  createSite,
} from "@/services/sites";

let db: TestDb;
let admin: Actor, ethics: Actor;
let trialId: string;

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      { email: "a@t.demo", passwordHash: "x", name: "A", role: "admin" },
      { email: "e@t.demo", passwordHash: "x", name: "E", role: "ethics" },
    ])
    .returning();
  admin = { id: rows[0].id, role: "admin" };
  ethics = { id: rows[1].id, role: "ethics" };
  const trial = await createTrial(db, admin, {
    protocolCode: "AYU-300",
    title: "Site service fixture trial",
    studyType: "observational",
    intervention: "Triphala",
    targetEnrollment: 50,
    visitPlan: [{ visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 }],
  });
  trialId = trial.id;
});

describe("T1.3 — site service", () => {
  it("creates a site, attaches it pending, then activates with timestamp — all audited", async () => {
    const site = await createSite(db, admin, {
      name: "NIA Jaipur",
      city: "Jaipur",
      state: "Rajasthan",
    });
    const ts = await attachSiteToTrial(db, admin, {
      trialId,
      siteId: site.id,
      enrollmentTarget: 25,
    });
    expect(ts.activationStatus).toBe("pending");
    expect(ts.activatedAt).toBeNull();

    const activated = await activateTrialSite(db, admin, ts.id);
    expect(activated.activationStatus).toBe("active");
    expect(activated.activatedAt).toBeInstanceOf(Date);

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, ts.id));
    const actions = audit.map((a) => a.action).sort();
    expect(actions).toEqual(["site.activate", "site.attach"]);
    const act = audit.find((a) => a.action === "site.activate")!;
    expect((act.before as { activationStatus: string }).activationStatus).toBe(
      "pending",
    );
  });

  it("cannot activate twice", async () => {
    const site = await createSite(db, admin, {
      name: "GAC Pune",
      city: "Pune",
      state: "MH",
    });
    const ts = await attachSiteToTrial(db, admin, {
      trialId,
      siteId: site.id,
      enrollmentTarget: 10,
    });
    await activateTrialSite(db, admin, ts.id);
    await expect(activateTrialSite(db, admin, ts.id)).rejects.toThrow(
      "not pending",
    );
  });

  it("ethics role cannot manage sites", async () => {
    await expect(
      createSite(db, ethics, { name: "X", city: "Y", state: "Z" }),
    ).rejects.toThrow(RbacError);
  });

  it("rejects duplicate trial-site attachment (unique index)", async () => {
    const site = await createSite(db, admin, {
      name: "AIIA Goa",
      city: "Panaji",
      state: "GA",
    });
    await attachSiteToTrial(db, admin, {
      trialId,
      siteId: site.id,
      enrollmentTarget: 5,
    });
    await expect(
      attachSiteToTrial(db, admin, {
        trialId,
        siteId: site.id,
        enrollmentTarget: 5,
      }),
    ).rejects.toThrow();
  });
});
