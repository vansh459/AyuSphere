/**
 * Real-registry seed (D-021): inserts REAL CTRI public trial registry
 * metadata (scraped by scripts/scrape/ctri_scrape.py — titles, CTRI numbers,
 * study type, phase, interventions, sample sizes, sponsors, sites/states)
 * while ALL participant-level data stays SYNTHETIC (faker, fixed seed),
 * exactly as D-016 / the SIH problem statement (DPDP) mandate.
 *
 * Idempotent: trials whose ctriNumber already exists are skipped, so it can
 * run against a database that already holds the demo seed (or itself).
 */
import { faker } from "@faker-js/faker";
import { inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import {
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
import { DEFAULT_CRF_FIELDS } from "@/lib/crf";
import ctriData from "./data/ctri_trials.json";

export type CtriTrialRecord = {
  ctri_number: string;
  title: string;
  study_type: string;
  phase: string | null;
  intervention: string;
  target_sample_size: number | null;
  sponsor: string | null;
  health_condition: string | null;
  sites: { name?: string | null; state?: string | null }[];
};

export type SeedRealSummary = {
  trialsInserted: number;
  trialsSkipped: number;
  sitesCreated: number;
  trialSitesLinked: number;
  templatesCreated: number;
  participantsCreated: number;
  visitsCreated: number;
};

const SITE_CAP = 10;
const PARTICIPANT_TRIALS = 6;
const DAY = 24 * 60 * 60 * 1000;

const DEFAULT_VISIT_PLAN = [
  { visitNumber: 1, name: "Baseline", dayOffset: 0, windowDays: 3 },
  { visitNumber: 2, name: "Follow-up", dayOffset: 30, windowDays: 7 },
];

function clampEnrollment(n: number | null | undefined): number {
  if (!n || !Number.isFinite(n)) return 60;
  return Math.min(1000, Math.max(10, Math.trunc(n)));
}

/** "Phase 2" -> "II", "Phase 2/ Phase 3" -> "II/III"; anything else kept raw. */
function normalizePhase(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned)) return null;
  const roman: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV" };
  const nums = [...cleaned.matchAll(/phase\s*(\d)/gi)].map((m) => roman[m[1]] ?? m[1]);
  if (nums.length > 0) return nums.join("/");
  return cleaned.slice(0, 40);
}

function protocolCodeFor(ctriNumber: string): string {
  const digits = ctriNumber.split("/").pop() ?? "";
  return `CTRI-${digits.slice(-6)}`;
}

export async function seedReal(db: Db): Promise<SeedRealSummary> {
  faker.seed(46046); // deterministic synthetic participants (SIH26046)

  const records = (ctriData as { trials: CtriTrialRecord[] }).trials.filter(
    (r) => /^CTRI\/\d{4}\/\d{2}\/\d{6}$/.test(r.ctri_number),
  );

  // ---- idempotency: skip already-present CTRI numbers ----
  const existing = await db
    .select({ ctriNumber: trials.ctriNumber })
    .from(trials)
    .where(isNotNull(trials.ctriNumber));
  const existingCtri = new Set(existing.map((r) => r.ctriNumber));
  const existingCodes = new Set(
    (await db.select({ code: trials.protocolCode }).from(trials)).map((r) => r.code),
  );
  const fresh = records.filter(
    (r) => !existingCtri.has(r.ctri_number) && !existingCodes.has(protocolCodeFor(r.ctri_number)),
  );

  if (fresh.length === 0) {
    return {
      trialsInserted: 0,
      trialsSkipped: records.length,
      sitesCreated: 0,
      trialSitesLinked: 0,
      templatesCreated: 0,
      participantsCreated: 0,
      visitsCreated: 0,
    };
  }

  // ---- creator user (synthetic role account, never real personnel) ----
  const piRows = await db.select().from(users).where(inArray(users.role, ["pi", "admin"]));
  let creatorId = piRows.find((u) => u.role === "pi")?.id ?? piRows[0]?.id;
  if (!creatorId) {
    const [created] = await db
      .insert(users)
      .values({
        email: "seed-real@aiia.demo",
        name: "Registry Import",
        role: "pi",
        passwordHash: await hashPassword("Demo@1234"),
      })
      .returning();
    creatorId = created.id;
  }

  // ---- sites from scraped states (metadata only), dedupe, cap ----
  const wantedSites: { name: string; state: string }[] = [];
  const seenSiteKeys = new Set<string>();
  for (const rec of fresh) {
    for (const s of rec.sites ?? []) {
      const name = (s.name ?? "").trim().slice(0, 120);
      const state = (s.state ?? "").trim();
      if (!name || !state) continue;
      const key = `${name.toLowerCase()}|${state.toLowerCase()}`;
      if (seenSiteKeys.has(key)) continue;
      seenSiteKeys.add(key);
      wantedSites.push({ name, state });
      if (wantedSites.length >= SITE_CAP) break;
    }
    if (wantedSites.length >= SITE_CAP) break;
  }
  if (wantedSites.length === 0) {
    wantedSites.push({ name: "AIIA New Delhi (registry import)", state: "Delhi" });
  }

  const existingSites = await db.select().from(sites);
  const siteByKey = new Map(
    existingSites.map((s) => [`${s.name.toLowerCase()}|${s.state.toLowerCase()}`, s]),
  );
  let sitesCreated = 0;
  const sitePool: (typeof existingSites)[number][] = [];
  for (const w of wantedSites) {
    const key = `${w.name.toLowerCase()}|${w.state.toLowerCase()}`;
    let site = siteByKey.get(key);
    if (!site) {
      [site] = await db
        .insert(sites)
        .values({ name: w.name, city: w.state, state: w.state })
        .returning();
      siteByKey.set(key, site);
      sitesCreated += 1;
    }
    sitePool.push(site);
  }

  // ---- trials ----
  const now = Date.now();
  const statusFor = (i: number) =>
    i % 2 === 0 ? ("active" as const) : i % 4 === 1 ? ("ctri_registered" as const) : ("iec_approved" as const);

  const trialValues = fresh.map((rec, i) => ({
    protocolCode: protocolCodeFor(rec.ctri_number),
    title: rec.title.slice(0, 300),
    ctriNumber: rec.ctri_number,
    studyType:
      rec.study_type === "observational"
        ? ("observational" as const)
        : ("interventional" as const),
    phase: normalizePhase(rec.phase),
    intervention: rec.intervention.slice(0, 300) || "Ayurveda intervention",
    targetEnrollment: clampEnrollment(rec.target_sample_size),
    status: statusFor(i),
    visitPlan: DEFAULT_VISIT_PLAN,
    plannedStart: new Date(now - (30 + (i % 8) * 10) * DAY),
    createdBy: creatorId,
  }));
  const trialRows = await db.insert(trials).values(trialValues).returning();

  // ---- CRF templates: one per visit-plan entry, never template-less ----
  const templateRows = await db
    .insert(crfTemplates)
    .values(
      trialRows.flatMap((t) =>
        (t.visitPlan as { name: string }[]).map((v) => ({
          trialId: t.id,
          visitType: v.name,
          name: `${t.protocolCode} — ${v.name} CRF`,
          fields: [...DEFAULT_CRF_FIELDS],
        })),
      ),
    )
    .returning();
  const templateFor = (trialId: string, visitName: string) =>
    templateRows.find((tt) => tt.trialId === trialId && tt.visitType === visitName)!;

  // ---- milestones (regulatory history consistent with each status) ----
  const milestoneValues = trialRows.flatMap((t, i) => {
    const rows: (typeof milestones.$inferInsert)[] = [];
    const registeredAgo = (40 + (i % 8) * 10) * DAY;
    // every one of these trials is past IEC approval
    rows.push({
      trialId: t.id,
      kind: "iec_approval",
      completedAt: new Date(now - registeredAgo - 10 * DAY),
    });
    if (t.status === "ctri_registered" || t.status === "active") {
      rows.push({
        trialId: t.id,
        kind: "ctri_registration",
        completedAt: new Date(now - registeredAgo),
      });
    }
    return rows;
  });
  await db.insert(milestones).values(milestoneValues);

  // ---- trial sites: 1-3 sites per trial from the pool, active ----
  const trialSiteValues = trialRows.flatMap((t, i) => {
    const rec = fresh[i];
    // prefer the trial's own scraped sites when they made the pool
    const own = sitePool.filter((s) =>
      (rec.sites ?? []).some(
        (w) =>
          (w.name ?? "").trim().toLowerCase() === s.name.toLowerCase() &&
          (w.state ?? "").trim().toLowerCase() === s.state.toLowerCase(),
      ),
    );
    const chosen = (own.length > 0 ? own : [sitePool[i % sitePool.length]]).slice(0, 3);
    const perSiteTarget = Math.max(5, Math.ceil(t.targetEnrollment / chosen.length));
    return chosen.map((s) => ({
      trialId: t.id,
      siteId: s.id,
      activationStatus: "active" as const,
      activatedAt: new Date(now - (20 + (i % 6) * 5) * DAY),
      enrollmentTarget: perSiteTarget,
    }));
  });
  const tsRows = await db.insert(trialSites).values(trialSiteValues).returning();

  // ---- SYNTHETIC participants + visits for the first ~6 trials ----
  const participantTrials = trialRows.slice(0, PARTICIPANT_TRIALS);
  let participantsCreated = 0;
  let visitsCreated = 0;

  for (const trial of participantTrials) {
    const links = tsRows.filter((ts) => ts.trialId === trial.id);
    if (links.length === 0) continue;
    const count = faker.number.int({ min: 5, max: 15 });
    const plan = trial.visitPlan as {
      visitNumber: number;
      name: string;
      dayOffset: number;
      windowDays: number;
    }[];

    const participantValues = Array.from({ length: count }, (_, k) => {
      const link = links[k % links.length];
      const enrolledDaysAgo = faker.number.int({ min: 3, max: 55 });
      return {
        subjectCode: `${trial.protocolCode}-P-${String(k + 1).padStart(4, "0")}`,
        trialSiteId: link.id,
        screeningStatus: "passed" as const,
        consentStatus: "given" as const,
        consentDate: new Date(now - (enrolledDaysAgo + 2) * DAY),
        arm: faker.helpers.arrayElement(["intervention", "control"]),
        status: "enrolled" as const,
        enrolledAt: new Date(now - enrolledDaysAgo * DAY),
      };
    });
    const participantRows = await db
      .insert(participants)
      .values(participantValues)
      .returning();
    participantsCreated += participantRows.length;

    const visitValues = participantRows.flatMap((p) => {
      const enrolled = p.enrolledAt!.getTime();
      return plan.map((v) => {
        const scheduled = enrolled + v.dayOffset * DAY;
        const windowMs = v.windowDays * DAY;
        const past = scheduled < now - windowMs;
        return {
          participantId: p.id,
          templateId: templateFor(trial.id, v.name).id,
          visitNumber: v.visitNumber,
          name: v.name,
          scheduledDate: new Date(scheduled),
          windowStart: new Date(scheduled - windowMs),
          windowEnd: new Date(scheduled + windowMs),
          status: past
            ? faker.number.int({ min: 1, max: 10 }) === 1
              ? ("overdue" as const)
              : ("completed" as const)
            : ("upcoming" as const),
          completedAt: past ? new Date(scheduled + DAY) : null,
        };
      });
    });
    const visitRows = await db.insert(visits).values(visitValues).returning();
    visitsCreated += visitRows.length;
  }

  return {
    trialsInserted: trialRows.length,
    trialsSkipped: records.length - fresh.length,
    sitesCreated,
    trialSitesLinked: tsRows.length,
    templatesCreated: templateRows.length,
    participantsCreated,
    visitsCreated,
  };
}
