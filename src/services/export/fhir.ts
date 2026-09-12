/**
 * FHIR R4 export — focused subset (D-017): ResearchStudy, ResearchSubject,
 * de-identified Patient, AdverseEvent, bundled per trial.
 * Pure mappers over Drizzle rows; structure tested in tests/fhir.test.ts.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import {
  adverseEvents,
  participants,
  trialSites,
  trials,
} from "@/db/schema";
import { decodeMeddra } from "@/lib/dictionaries/meddra-subset";

type TrialRow = typeof trials.$inferSelect;
type ParticipantRow = typeof participants.$inferSelect;
type AeRow = typeof adverseEvents.$inferSelect;

const STATUS_MAP: Record<string, string> = {
  draft: "in-review",
  iec_review: "in-review",
  iec_approved: "approved",
  ctri_registered: "approved",
  active: "active",
  enrolment_closed: "closed-to-accrual",
  followup: "closed-to-accrual-and-intervention",
  closeout: "completed",
};

export function toResearchStudy(trial: TrialRow) {
  return {
    resourceType: "ResearchStudy" as const,
    id: trial.id,
    identifier: [
      { system: "urn:aiia:protocol", value: trial.protocolCode },
      ...(trial.ctriNumber
        ? [{ system: "https://ctri.nic.in", value: trial.ctriNumber }]
        : []),
    ],
    title: trial.title,
    status: STATUS_MAP[trial.status] ?? "active",
    category: [
      {
        coding: [
          {
            system: "http://hl7.org/fhir/research-study-prim-purp-type",
            code: trial.studyType === "interventional" ? "treatment" : "screening",
          },
        ],
      },
    ],
    description: `${trial.intervention}${trial.dosageForm ? ` (${trial.dosageForm})` : ""} — Ayurveda clinical study`,
    enrollment: [{ display: `target ${trial.targetEnrollment}` }],
  };
}

/**
 * De-identified by construction: identifier = subject code ONLY.
 * No name, telecom, address, or birthDate keys exist on the output.
 */
export function toPatient(p: ParticipantRow) {
  return {
    resourceType: "Patient" as const,
    id: p.id,
    identifier: [{ system: "urn:aiia:subject", value: p.subjectCode }],
  };
}

const SUBJECT_STATUS: Record<string, string> = {
  screening: "screening",
  enrolled: "on-study",
  withdrawn: "withdrawn",
  completed: "off-study",
};

export function toResearchSubject(p: ParticipantRow, trialId: string) {
  return {
    resourceType: "ResearchSubject" as const,
    id: `rs-${p.id}`,
    status: SUBJECT_STATUS[p.status] ?? "on-study",
    study: { reference: `ResearchStudy/${trialId}` },
    individual: { reference: `Patient/${p.id}` },
    ...(p.arm ? { actualArm: p.arm } : {}),
  };
}

export function toAdverseEvent(ae: AeRow) {
  const meddra = decodeMeddra(ae.meddraCode);
  return {
    resourceType: "AdverseEvent" as const,
    id: ae.id,
    actuality: "actual" as const,
    subject: { reference: `Patient/${ae.participantId}` },
    event: {
      text: ae.term,
      ...(ae.meddraCode
        ? {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/meddra",
                code: ae.meddraCode,
                ...(meddra ? { display: meddra.pt } : {}),
              },
            ],
          }
        : {}),
    },
    date: ae.onsetDate.toISOString(),
    seriousness: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/adverse-event-seriousness",
          code: ae.seriousness === "sae" ? "serious" : "non-serious",
        },
      ],
    },
    severity: { text: ae.severity },
    ...(ae.outcome ? { outcome: { text: ae.outcome } } : {}),
  };
}

export async function buildTrialBundle(db: Db, trialId: string) {
  const [trial] = await db
    .select()
    .from(trials)
    .where(eq(trials.id, trialId))
    .limit(1);
  if (!trial) throw new Error("trial not found");

  const tsRows = await db
    .select({ id: trialSites.id })
    .from(trialSites)
    .where(eq(trialSites.trialId, trialId));
  const tsIds = tsRows.map((r) => r.id);
  const parts = tsIds.length
    ? await db
        .select()
        .from(participants)
        .where(inArray(participants.trialSiteId, tsIds))
    : [];
  const partIds = parts.map((p) => p.id);
  const aes = partIds.length
    ? await db
        .select()
        .from(adverseEvents)
        .where(inArray(adverseEvents.participantId, partIds))
    : [];

  const resources = [
    toResearchStudy(trial),
    ...parts.map(toPatient),
    ...parts.map((p) => toResearchSubject(p, trialId)),
    ...aes.map(toAdverseEvent),
  ];

  return {
    resourceType: "Bundle" as const,
    type: "collection" as const,
    timestamp: new Date().toISOString(),
    total: resources.length,
    entry: resources.map((r) => ({ resource: r })),
  };
}
