CREATE TYPE "public"."activation_status" AS ENUM('pending', 'active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."ae_seriousness" AS ENUM('ae', 'sae');--> statement-breakpoint
CREATE TYPE "public"."ae_severity" AS ENUM('mild', 'moderate', 'severe');--> statement-breakpoint
CREATE TYPE "public"."ae_status" AS ENUM('open', 'under_review', 'reported', 'closed');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'danger');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('not_taken', 'given', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."crf_entry_status" AS ENUM('draft', 'submitted', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('protocol', 'ethics_approval', 'consent_form', 'monitoring_report', 'regulatory');--> statement-breakpoint
CREATE TYPE "public"."entry_source" AS ENUM('manual', 'extraction');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('pending', 'review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."milestone_kind" AS ENUM('iec_submission', 'iec_approval', 'ctri_registration', 'first_enrolment', 'last_visit', 'closeout');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('screening', 'enrolled', 'withdrawn', 'completed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('pi', 'coordinator', 'monitor', 'ethics', 'pv', 'admin', 'regulator');--> statement-breakpoint
CREATE TYPE "public"."screening_status" AS ENUM('pending', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."study_type" AS ENUM('interventional', 'observational');--> statement-breakpoint
CREATE TYPE "public"."trial_status" AS ENUM('draft', 'iec_review', 'iec_approved', 'ctri_registered', 'active', 'enrolment_closed', 'followup', 'closeout');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('upcoming', 'due', 'overdue', 'completed', 'missed', 'cancelled');--> statement-breakpoint
CREATE TABLE "adverse_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"term" text NOT NULL,
	"meddra_code" text,
	"whodrug_code" text,
	"onset_date" timestamp with time zone NOT NULL,
	"seriousness" "ae_seriousness" NOT NULL,
	"severity" "ae_severity" NOT NULL,
	"outcome" text,
	"causality" text,
	"narrative" text,
	"reporting_deadline" timestamp with time zone NOT NULL,
	"detailed_report_deadline" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"status" "ae_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ae_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ae_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid,
	"site_id" uuid,
	"rule_key" text NOT NULL,
	"entity_ref" text NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"message" text NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"acknowledged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crf_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "crf_entry_status" DEFAULT 'draft' NOT NULL,
	"source" "entry_source" DEFAULT 'manual' NOT NULL,
	"extraction_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"entered_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crf_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"visit_type" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"blob_url" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"blob_url" text NOT NULL,
	"image_quality" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_output" jsonb,
	"mapped_fields" jsonb,
	"validation_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_id" text,
	"prompt_version" text,
	"status" "extraction_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"kind" "milestone_kind" NOT NULL,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_code" text NOT NULL,
	"trial_site_id" uuid NOT NULL,
	"screening_status" "screening_status" DEFAULT 'pending' NOT NULL,
	"eligibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_status" "consent_status" DEFAULT 'not_taken' NOT NULL,
	"consent_date" timestamp with time zone,
	"consent_document_id" uuid,
	"arm" text,
	"status" "participant_status" DEFAULT 'screening' NOT NULL,
	"enrolled_at" timestamp with time zone,
	"withdrawal_reason" text,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_subject_code_unique" UNIQUE("subject_code")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"pi_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"activation_status" "activation_status" DEFAULT 'pending' NOT NULL,
	"activated_at" timestamp with time zone,
	"enrollment_target" integer DEFAULT 0 NOT NULL,
	"monitoring_visit_due" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_code" text NOT NULL,
	"title" text NOT NULL,
	"ctri_number" text,
	"study_type" "study_type" NOT NULL,
	"phase" text,
	"intervention" text NOT NULL,
	"dosage_form" text,
	"target_enrollment" integer NOT NULL,
	"status" "trial_status" DEFAULT 'draft' NOT NULL,
	"visit_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"planned_start" timestamp with time zone,
	"planned_end" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trials_protocol_code_unique" UNIQUE("protocol_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"site_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"template_id" uuid,
	"visit_number" integer NOT NULL,
	"name" text NOT NULL,
	"scheduled_date" timestamp with time zone NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"status" "visit_status" DEFAULT 'upcoming' NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "adverse_events" ADD CONSTRAINT "adverse_events_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ae_actions" ADD CONSTRAINT "ae_actions_ae_id_adverse_events_id_fk" FOREIGN KEY ("ae_id") REFERENCES "public"."adverse_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crf_entries" ADD CONSTRAINT "crf_entries_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crf_entries" ADD CONSTRAINT "crf_entries_template_id_crf_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."crf_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crf_templates" ADD CONSTRAINT "crf_templates_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_trial_site_id_trial_sites_id_fk" FOREIGN KEY ("trial_site_id") REFERENCES "public"."trial_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_sites" ADD CONSTRAINT "trial_sites_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_sites" ADD CONSTRAINT "trial_sites_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_template_id_crf_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."crf_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rule_entity_open" ON "alerts" USING btree ("rule_key","entity_ref") WHERE "alerts"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "trial_site_unique" ON "trial_sites" USING btree ("trial_id","site_id");