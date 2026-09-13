/**
 * AyuSphere database schema — docs/architecture.md §3.
 * CDASH-aligned field naming (D-017). Participants carry NO direct
 * identifiers — de-identification by schema (D-016).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- enums ----------

export const roleEnum = pgEnum("role", [
  "pi",
  "coordinator",
  "monitor",
  "ethics",
  "pv",
  "admin",
  "regulator",
]);

export const trialStatusEnum = pgEnum("trial_status", [
  "draft",
  "iec_review",
  "iec_approved",
  "ctri_registered",
  "active",
  "enrolment_closed",
  "followup",
  "closeout",
]);

export const studyTypeEnum = pgEnum("study_type", [
  "interventional",
  "observational",
]);

export const activationStatusEnum = pgEnum("activation_status", [
  "pending",
  "active",
  "deactivated",
]);

export const screeningStatusEnum = pgEnum("screening_status", [
  "pending",
  "passed",
  "failed",
]);

export const consentStatusEnum = pgEnum("consent_status", [
  "not_taken",
  "given",
  "withdrawn",
]);

export const participantStatusEnum = pgEnum("participant_status", [
  "screening",
  "enrolled",
  "withdrawn",
  "completed",
]);

export const visitStatusEnum = pgEnum("visit_status", [
  "upcoming",
  "due",
  "overdue",
  "completed",
  "missed",
  "cancelled",
]);

export const crfEntryStatusEnum = pgEnum("crf_entry_status", [
  "draft",
  "submitted",
  "approved",
  "superseded",
]);

export const entrySourceEnum = pgEnum("entry_source", ["manual", "extraction"]);

export const extractionStatusEnum = pgEnum("extraction_status", [
  "pending",
  "review",
  "approved",
  "rejected",
]);

export const aeSeriousnessEnum = pgEnum("ae_seriousness", ["ae", "sae"]);

export const aeSeverityEnum = pgEnum("ae_severity", [
  "mild",
  "moderate",
  "severe",
]);

export const aeStatusEnum = pgEnum("ae_status", [
  "open",
  "under_review",
  "reported",
  "closed",
]);

export const amendmentStatusEnum = pgEnum("amendment_status", [
  "submitted",
  "approved",
  "returned",
]);

export const queryStatusEnum = pgEnum("query_status", [
  "open",
  "answered",
  "closed",
]);

export const adrSourceEnum = pgEnum("adr_source", [
  "hospital",
  "community",
  "literature",
]);

export const adrStatusEnum = pgEnum("adr_status", [
  "received",
  "assessed",
  "forwarded",
]);

export const documentKindEnum = pgEnum("document_kind", [
  "protocol",
  "ethics_approval",
  "consent_form",
  "monitoring_report",
  "regulatory",
]);

export const milestoneKindEnum = pgEnum("milestone_kind", [
  "iec_submission",
  "iec_approval",
  "ctri_registration",
  "first_enrolment",
  "last_visit",
  "closeout",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "info",
  "warning",
  "danger",
]);

export const alertStatusEnum = pgEnum("alert_status", [
  "open",
  "acknowledged",
  "resolved",
]);

// ---------- tables ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  siteId: uuid("site_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const trials = pgTable("trials", {
  id: uuid("id").primaryKey().defaultRandom(),
  protocolCode: text("protocol_code").notNull().unique(),
  title: text("title").notNull(),
  ctriNumber: text("ctri_number"),
  studyType: studyTypeEnum("study_type").notNull(),
  phase: text("phase"),
  intervention: text("intervention").notNull(),
  dosageForm: text("dosage_form"),
  targetEnrollment: integer("target_enrollment").notNull(),
  status: trialStatusEnum("status").notNull().default("draft"),
  /** protocol visit plan: [{ visitNumber, name, dayOffset, windowDays }] */
  visitPlan: jsonb("visit_plan").notNull().default([]),
  /** randomization arms (T10.2, D-027): [{ name, ratio }] — empty = default 1:1 */
  arms: jsonb("arms").notNull().default([]),
  /** bumped by each APPLIED protocol amendment (T10.3) */
  protocolVersion: integer("protocol_version").notNull().default(1),
  plannedStart: timestamp("planned_start", { withTimezone: true }),
  plannedEnd: timestamp("planned_end", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  piUserId: uuid("pi_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const trialSites = pgTable(
  "trial_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trialId: uuid("trial_id")
      .notNull()
      .references(() => trials.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    activationStatus: activationStatusEnum("activation_status")
      .notNull()
      .default("pending"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    enrollmentTarget: integer("enrollment_target").notNull().default(0),
    monitoringVisitDue: timestamp("monitoring_visit_due", {
      withTimezone: true,
    }),
  },
  (t) => [uniqueIndex("trial_site_unique").on(t.trialId, t.siteId)],
);

/**
 * De-identified by design: no name / phone / address / dob columns exist.
 * subjectCode is the only identity (e.g. AYU-001-P-0042).
 */
export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectCode: text("subject_code").notNull().unique(),
  trialSiteId: uuid("trial_site_id")
    .notNull()
    .references(() => trialSites.id),
  screeningStatus: screeningStatusEnum("screening_status")
    .notNull()
    .default("pending"),
  eligibility: jsonb("eligibility").notNull().default({}),
  consentStatus: consentStatusEnum("consent_status")
    .notNull()
    .default("not_taken"),
  consentDate: timestamp("consent_date", { withTimezone: true }),
  consentDocumentId: uuid("consent_document_id"),
  arm: text("arm"),
  status: participantStatusEnum("status").notNull().default("screening"),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
  withdrawalReason: text("withdrawal_reason"),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const crfTemplates = pgTable("crf_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  trialId: uuid("trial_id")
    .notNull()
    .references(() => trials.id),
  visitType: text("visit_type").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  /** [{ name, label, type, unit?, min?, max?, required, cdashVar }] */
  fields: jsonb("fields").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const visits = pgTable("visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  templateId: uuid("template_id").references(() => crfTemplates.id),
  visitNumber: integer("visit_number").notNull(),
  name: text("name").notNull(),
  scheduledDate: timestamp("scheduled_date", { withTimezone: true }).notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  status: visitStatusEnum("status").notNull().default("upcoming"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const crfEntries = pgTable("crf_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => visits.id),
  templateId: uuid("template_id")
    .notNull()
    .references(() => crfTemplates.id),
  data: jsonb("data").notNull().default({}),
  status: crfEntryStatusEnum("status").notNull().default("draft"),
  source: entrySourceEnum("source").notNull().default("manual"),
  extractionId: uuid("extraction_id"),
  version: integer("version").notNull().default(1),
  supersedesId: uuid("supersedes_id"),
  enteredBy: uuid("entered_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const extractions = pgTable("extractions", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => visits.id),
  blobUrl: text("blob_url").notNull(),
  imageQuality: jsonb("image_quality").notNull().default({}),
  rawOutput: jsonb("raw_output"),
  /** { [field]: { value, confidence, sourceText } } */
  mappedFields: jsonb("mapped_fields"),
  validationFlags: jsonb("validation_flags").notNull().default([]),
  modelId: text("model_id"),
  promptVersion: text("prompt_version"),
  status: extractionStatusEnum("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const adverseEvents = pgTable("adverse_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  term: text("term").notNull(),
  meddraCode: text("meddra_code"),
  whodrugCode: text("whodrug_code"),
  onsetDate: timestamp("onset_date", { withTimezone: true }).notNull(),
  seriousness: aeSeriousnessEnum("seriousness").notNull(),
  severity: aeSeverityEnum("severity").notNull(),
  outcome: text("outcome"),
  causality: text("causality"),
  narrative: text("narrative"),
  reportingDeadline: timestamp("reporting_deadline", {
    withTimezone: true,
  }).notNull(),
  detailedReportDeadline: timestamp("detailed_report_deadline", {
    withTimezone: true,
  }),
  reportedAt: timestamp("reported_at", { withTimezone: true }),
  status: aeStatusEnum("status").notNull().default("open"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const aeActions = pgTable("ae_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  aeId: uuid("ae_id")
    .notNull()
    .references(() => adverseEvents.id),
  action: text("action").notNull(),
  actorId: uuid("actor_id").notNull(),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  trialId: uuid("trial_id")
    .notNull()
    .references(() => trials.id),
  kind: documentKindEnum("kind").notNull(),
  title: text("title").notNull(),
  version: integer("version").notNull().default(1),
  blobUrl: text("blob_url").notNull(),
  uploadedBy: uuid("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const milestones = pgTable("milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  trialId: uuid("trial_id")
    .notNull()
    .references(() => trials.id),
  kind: milestoneKindEnum("kind").notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trialId: uuid("trial_id").references(() => trials.id),
    siteId: uuid("site_id").references(() => sites.id),
    ruleKey: text("rule_key").notNull(),
    entityRef: text("entity_ref").notNull(),
    severity: alertSeverityEnum("severity").notNull(),
    message: text("message").notNull(),
    status: alertStatusEnum("status").notNull().default("open"),
    acknowledgedBy: uuid("acknowledged_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    // idempotency: at most one OPEN alert per (rule, entity)
    uniqueIndex("alert_rule_entity_open")
      .on(t.ruleKey, t.entityRef)
      .where(sql`${t.status} = 'open'`),
  ],
);

/** Runtime app configuration (e.g. AI provider/model/key) — admin-managed. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Internal user-to-user messaging. Content is NEVER copied into the audit
 * trail — audit rows for message.send carry only the recipient id (privacy).
 */
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  senderId: uuid("sender_id").notNull(),
  recipientId: uuid("recipient_id").notNull(),
  body: text("body").notNull().default(""),
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Protocol amendments (T10.3) — IEC oversight beyond the initial review:
 * PI/coordinator submit, ethics approve/return; an APPROVED, not-yet-applied
 * amendment is the gate for protocol changes (visit plan / arms) on trials
 * past draft, and applying it bumps trials.protocol_version.
 */
export const amendments = pgTable("amendments", {
  id: uuid("id").primaryKey().defaultRandom(),
  trialId: uuid("trial_id")
    .notNull()
    .references(() => trials.id),
  /** sequential per trial */
  versionNumber: integer("version_number").notNull(),
  summary: text("summary").notNull(),
  documentId: uuid("document_id"),
  status: amendmentStatusEnum("status").notNull().default("submitted"),
  submittedBy: uuid("submitted_by").notNull(),
  comment: text("comment"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Data-query management (T10.1) — the human query loop the PS's
 * "data-query status" names: a monitor raises a query on a CRF entry,
 * data-entry roles answer, the monitor closes. An OPEN query blocks the
 * entry's approval.
 */
export const dataQueries = pgTable("data_queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  crfEntryId: uuid("crf_entry_id")
    .notNull()
    .references(() => crfEntries.id),
  question: text("question").notNull(),
  status: queryStatusEnum("status").notNull().default("open"),
  raisedBy: uuid("raised_by").notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  closedBy: uuid("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** the query's response thread */
export const dataQueryMessages = pgTable("data_query_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  queryId: uuid("query_id")
    .notNull()
    .references(() => dataQueries.id),
  authorId: uuid("author_id").notNull(),
  authorRole: text("author_role").notNull(),
  body: text("body").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Spontaneous suspected-ADR reports for ASU&H drugs (T8.3, D-025) —
 * AIIA's NPvCC surveillance role. Deliberately NOT linked to trial
 * participants (de-identified spontaneous reports from outside trials);
 * reporterRole is a role word, never an identity.
 */
export const suspectedAdrs = pgTable("suspected_adrs", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: adrSourceEnum("source").notNull(),
  /** verbatim reaction wording from the report */
  term: text("term").notNull(),
  meddraCode: text("meddra_code"),
  /** verbatim suspected ASU formulation */
  suspectedDrug: text("suspected_drug").notNull(),
  whodrugCode: text("whodrug_code"),
  eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
  seriousness: aeSeriousnessEnum("seriousness").notNull(),
  outcome: text("outcome"),
  narrative: text("narrative"),
  reporterRole: text("reporter_role"),
  status: adrStatusEnum("status").notNull().default("received"),
  assessmentNote: text("assessment_note"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Monitoring visits (T7.3): a monitor's scheduled/completed site visits.
 * Completing one advances trial_sites.monitoring_visit_due by the
 * configured cadence (D-023); the sweep raises monitoring_overdue when the
 * due date passes without a visit.
 */
export const monitoringVisits = pgTable("monitoring_visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  trialSiteId: uuid("trial_site_id")
    .notNull()
    .references(() => trialSites.id),
  monitorId: uuid("monitor_id").notNull(),
  scheduledDate: timestamp("scheduled_date", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  summary: text("summary"),
  /** free-form finding lines recorded at completion */
  findings: jsonb("findings").notNull().default([]),
  reportDocumentId: uuid("report_document_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Electronic signatures (D-022): one row per signed record-freezing action
 * (CRF approve/correct, extraction approve, AE report). The signer re-enters
 * their password; payload_hash is the SHA-256 of the canonical signed
 * content. Insert-only like audit_events — a signature is never edited.
 */
export const signatures = pgTable("signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").notNull(),
  actorRole: text("actor_role").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  meaning: text("meaning").notNull(),
  payloadHash: text("payload_hash").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const guideRoleEnum = pgEnum("guide_role", ["user", "assistant"]);

/**
 * Sphera guide chat memory (D-029): per-user conversation threads persisted
 * server-side so the guide remembers across refreshes and devices. Like
 * `messages`, guide chats are communication — content is NEVER copied into
 * the audit trail.
 */
export const guideMessages = pgTable(
  "guide_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    threadId: text("thread_id").notNull(),
    role: guideRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("guide_msg_thread_idx").on(t.userId, t.threadId, t.createdAt)],
);

/** Insert-only (D-010). The app role gets no UPDATE/DELETE grant. */
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id"),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  requestId: text("request_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
