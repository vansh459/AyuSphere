/**
 * Deterministic synthetic seed (D-016) — no real personal data, ever.
 * faker runs on a fixed seed; subject codes are sequential; "demo moments"
 * are planted deliberately:
 *   - one open SAE ~18h from its reporting deadline (escalation clock demo)
 *   - one site lagging far behind its enrolment target (recruitment alert)
 *   - one approved CRF with a dose that a later doctor-note contradicts
 */
import { faker } from "@faker-js/faker";
import type { Db } from "@/db";
import {
  adverseEvents,
  aeActions,
  auditEvents,
  crfEntries,
  crfTemplates,
  milestones,
  participants,
  sites,
  trialSites,
  trials,
  users,
  visits,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth-core";
import type { Role } from "@/lib/rbac";

export const DEMO_PASSWORD = "Demo@1234";

export const DEMO_USERS: { email: string; name: string; role: Role }[] = [
  { email: "pi@aiia.demo", name: "Dr. Ananya Sharma", role: "pi" },
  { email: "coordinator@aiia.demo", name: "Ravi Kumar", role: "coordinator" },
  { email: "monitor@aiia.demo", name: "Meera Nair", role: "monitor" },
  { email: "ethics@aiia.demo", name: "Prof. S. Iyer", role: "ethics" },
  { email: "pv@aiia.demo", name: "Dr. Farid Khan", role: "pv" },
  { email: "admin@aiia.demo", name: "Admin AIIA", role: "admin" },
  { email: "regulator@aiia.demo", name: "CDSCO Observer", role: "regulator" },
];

import { DEFAULT_CRF_FIELDS } from "@/lib/crf";

const VITALS_FIELDS = DEFAULT_CRF_FIELDS;

export type SeedSummary = {
  users: number;
  trials: number;
  sites: number;
  participants: number;
  visits: number;
  adverseEvents: number;
};

export async function seed(db: Db): Promise<SeedSummary> {
  faker.seed(46); // SIH26046

  // one hash for all demo users keeps seeding fast and deterministic
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const userRows = await db
    .insert(users)
    .values(DEMO_USERS.map((u) => ({ ...u, passwordHash })))
    .returning();
  const byRole = Object.fromEntries(userRows.map((u) => [u.role, u]));

  const siteRows = await db
    .insert(sites)
    .values([
      { name: "AIIA New Delhi", city: "New Delhi", state: "Delhi", piUserId: byRole.pi.id },
      { name: "NIA Jaipur", city: "Jaipur", state: "Rajasthan" },
      { name: "GAC Pune", city: "Pune", state: "Maharashtra" },
    ])
    .returning();

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const trialRows = await db
    .insert(trials)
    .values([
      {
        protocolCode: "AYU-001",
        title: "Ashwagandha in Generalized Anxiety — RCT",
        ctriNumber: "CTRI/2026/04/012345",
        studyType: "interventional",
        phase: "II",
        intervention: "Ashwagandha root extract",
        dosageForm: "capsule",
        targetEnrollment: 120,
        status: "active",
        visitPlan: [
          { visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 },
          { visitNumber: 2, name: "Month 1 Follow-up", dayOffset: 30, windowDays: 7 },
          { visitNumber: 3, name: "Month 3 Final", dayOffset: 90, windowDays: 7 },
        ],
        plannedStart: new Date(now - 120 * day),
        createdBy: byRole.pi.id,
      },
      {
        protocolCode: "AYU-002",
        title: "Triphala in Functional Constipation — Observational",
        ctriNumber: "CTRI/2026/06/067890",
        studyType: "observational",
        intervention: "Triphala churna",
        dosageForm: "powder",
        targetEnrollment: 200,
        status: "active",
        visitPlan: [
          { visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 },
          { visitNumber: 2, name: "Week 6 Review", dayOffset: 42, windowDays: 7 },
        ],
        plannedStart: new Date(now - 60 * day),
        createdBy: byRole.pi.id,
      },
      {
        protocolCode: "AYU-003",
        title: "Brahmi Ghrita in Cognitive Decline — Pilot",
        studyType: "interventional",
        phase: "I",
        intervention: "Brahmi ghrita",
        dosageForm: "ghee",
        targetEnrollment: 40,
        status: "iec_review",
        visitPlan: [
          { visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 },
        ],
        createdBy: byRole.pi.id,
      },
    ])
    .returning();

  const [ayu1, ayu2, ayu3] = trialRows;

  // milestones
  await db.insert(milestones).values([
    { trialId: ayu1.id, kind: "iec_approval", completedAt: new Date(now - 140 * day) },
    { trialId: ayu1.id, kind: "ctri_registration", completedAt: new Date(now - 130 * day) },
    { trialId: ayu2.id, kind: "iec_approval", completedAt: new Date(now - 80 * day) },
    { trialId: ayu2.id, kind: "ctri_registration", completedAt: new Date(now - 70 * day) },
    // planted: ethics decision pending with a due date approaching
    { trialId: ayu3.id, kind: "iec_approval", dueDate: new Date(now + 5 * day) },
  ]);

  // trial-site links: AYU-001 at all 3 sites, AYU-002 at 2
  const tsRows = await db
    .insert(trialSites)
    .values([
      { trialId: ayu1.id, siteId: siteRows[0].id, activationStatus: "active", activatedAt: new Date(now - 110 * day), enrollmentTarget: 50 },
      { trialId: ayu1.id, siteId: siteRows[1].id, activationStatus: "active", activatedAt: new Date(now - 100 * day), enrollmentTarget: 40 },
      // planted lagging site: target 30, will get very few participants
      { trialId: ayu1.id, siteId: siteRows[2].id, activationStatus: "active", activatedAt: new Date(now - 90 * day), enrollmentTarget: 30 },
      { trialId: ayu2.id, siteId: siteRows[0].id, activationStatus: "active", activatedAt: new Date(now - 55 * day), enrollmentTarget: 120 },
      { trialId: ayu2.id, siteId: siteRows[1].id, activationStatus: "active", activatedAt: new Date(now - 50 * day), enrollmentTarget: 80 },
    ])
    .returning();

  // CRF templates
  const templateRows = await db
    .insert(crfTemplates)
    .values(
      trialRows.flatMap((t) =>
        (t.visitPlan as { name: string }[]).map((v) => ({
          trialId: t.id,
          visitType: v.name,
          name: `${t.protocolCode} — ${v.name} CRF`,
          fields: [...VITALS_FIELDS],
        })),
      ),
    )
    .returning();
  const templateFor = (trialId: string, visitName: string) =>
    templateRows.find((tt) => tt.trialId === trialId && tt.visitType === visitName)!;

  // participants: distribution plants the lagging site (index 2 gets 3)
  const perSite = [24, 18, 3, 12, 9] as const;
  let seq = 0;
  const participantValues = tsRows.flatMap((ts, i) => {
    const trial = trialRows.find((t) => t.id === ts.trialId)!;
    return Array.from({ length: perSite[i] }, () => {
      seq += 1;
      const code = `${trial.protocolCode}-P-${String(seq).padStart(4, "0")}`;
      const enrolledDaysAgo = faker.number.int({ min: 5, max: 85 });
      return {
        subjectCode: code,
        trialSiteId: ts.id,
        screeningStatus: "passed" as const,
        consentStatus: "given" as const,
        consentDate: new Date(now - (enrolledDaysAgo + 2) * day),
        arm: faker.helpers.arrayElement(["intervention", "control"]),
        status: "enrolled" as const,
        enrolledAt: new Date(now - enrolledDaysAgo * day),
      };
    });
  });
  const participantRows = await db
    .insert(participants)
    .values(participantValues)
    .returning();

  // visits from each trial's visit plan
  const visitValues = participantRows.flatMap((p) => {
    const ts = tsRows.find((t) => t.id === p.trialSiteId)!;
    const trial = trialRows.find((t) => t.id === ts.trialId)!;
    const plan = trial.visitPlan as {
      visitNumber: number;
      name: string;
      dayOffset: number;
      windowDays: number;
    }[];
    const enrolled = p.enrolledAt!.getTime();
    return plan.map((v) => {
      const scheduled = enrolled + v.dayOffset * day;
      const windowMs = v.windowDays * day;
      const past = scheduled < now - windowMs;
      return {
        participantId: p.id,
        templateId: templateFor(trial.id, v.name).id,
        visitNumber: v.visitNumber,
        name: v.name,
        scheduledDate: new Date(scheduled),
        windowStart: new Date(scheduled - windowMs),
        windowEnd: new Date(scheduled + windowMs),
        // most past visits completed; ~1 in 8 left overdue for the demo
        status: past
          ? faker.number.int({ min: 1, max: 8 }) === 1
            ? ("overdue" as const)
            : ("completed" as const)
          : ("upcoming" as const),
        completedAt: past ? new Date(scheduled + day) : null,
      };
    });
  });
  const visitRows = await db.insert(visits).values(visitValues).returning();

  // planted contradiction: participant #1's completed baseline has dose 500 mg
  const p1 = participantRows[0];
  const p1Baseline = visitRows.find(
    (v) => v.participantId === p1.id && v.visitNumber === 1,
  )!;
  await db.insert(crfEntries).values({
    visitId: p1Baseline.id,
    templateId: p1Baseline.templateId!,
    data: { sbp: 128, dbp: 84, pulse: 76, dose_mg: 500, notes: "Baseline stable" },
    status: "approved",
    source: "manual",
    enteredBy: byRole.coordinator.id,
    approvedBy: byRole.pi.id,
    approvedAt: new Date(now - 20 * day),
  });

  // adverse events — planted SAE with a live countdown (~18h left)
  const aeRows = await db
    .insert(adverseEvents)
    .values([
      {
        participantId: p1.id,
        term: "Severe gastric irritation",
        seriousness: "sae",
        severity: "severe",
        onsetDate: new Date(now - 6 * 60 * 60 * 1000),
        narrative:
          "Participant reported severe gastric irritation 2h post-dose; hospitalized for observation.",
        reportingDeadline: new Date(now + 18 * 60 * 60 * 1000),
        detailedReportDeadline: new Date(now + 14 * day - 6 * 60 * 60 * 1000),
        status: "open",
        createdBy: byRole.pi.id,
      },
      {
        participantId: participantRows[10].id,
        term: "Mild nausea",
        seriousness: "ae",
        severity: "mild",
        onsetDate: new Date(now - 12 * day),
        outcome: "resolved",
        reportingDeadline: new Date(now - 5 * day),
        reportedAt: new Date(now - 6 * day),
        status: "closed",
        createdBy: byRole.coordinator.id,
      },
      {
        participantId: participantRows[30].id,
        term: "Transient dizziness",
        seriousness: "ae",
        severity: "moderate",
        onsetDate: new Date(now - 3 * day),
        reportingDeadline: new Date(now + 4 * day),
        status: "under_review",
        createdBy: byRole.pv.id,
      },
    ])
    .returning();

  await db.insert(aeActions).values([
    { aeId: aeRows[0].id, action: "captured", actorId: byRole.pi.id },
    { aeId: aeRows[1].id, action: "captured", actorId: byRole.coordinator.id },
    { aeId: aeRows[1].id, action: "reported", actorId: byRole.pv.id },
    { aeId: aeRows[1].id, action: "closed", actorId: byRole.pv.id },
    { aeId: aeRows[2].id, action: "captured", actorId: byRole.pv.id },
    { aeId: aeRows[2].id, action: "review_started", actorId: byRole.pv.id },
  ]);

  // pre-aged audit events so the audit browser is not empty on first demo
  await db.insert(auditEvents).values([
    {
      actorId: byRole.pi.id,
      actorRole: "pi",
      action: "trial.create",
      entityType: "trial",
      entityId: ayu1.id,
      after: { protocolCode: "AYU-001", status: "draft" },
      at: new Date(now - 150 * day),
    },
    {
      actorId: byRole.ethics.id,
      actorRole: "ethics",
      action: "trial.transition",
      entityType: "trial",
      entityId: ayu1.id,
      before: { status: "iec_review" },
      after: { status: "iec_approved" },
      at: new Date(now - 140 * day),
    },
    {
      actorId: byRole.coordinator.id,
      actorRole: "coordinator",
      action: "trial.transition",
      entityType: "trial",
      entityId: ayu1.id,
      before: { status: "iec_approved" },
      after: { status: "ctri_registered", ctriNumber: "CTRI/2026/04/012345" },
      at: new Date(now - 130 * day),
    },
  ]);

  return {
    users: userRows.length,
    trials: trialRows.length,
    sites: siteRows.length,
    participants: participantRows.length,
    visits: visitRows.length,
    adverseEvents: aeRows.length,
  };
}
