CREATE TYPE "public"."amendment_status" AS ENUM('submitted', 'approved', 'returned');--> statement-breakpoint
CREATE TABLE "amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"summary" text NOT NULL,
	"document_id" uuid,
	"status" "amendment_status" DEFAULT 'submitted' NOT NULL,
	"submitted_by" uuid NOT NULL,
	"comment" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "protocol_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "amendments" ADD CONSTRAINT "amendments_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE no action ON UPDATE no action;