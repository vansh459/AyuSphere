CREATE TYPE "public"."adr_source" AS ENUM('hospital', 'community', 'literature');--> statement-breakpoint
CREATE TYPE "public"."adr_status" AS ENUM('received', 'assessed', 'forwarded');--> statement-breakpoint
CREATE TABLE "suspected_adrs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "adr_source" NOT NULL,
	"term" text NOT NULL,
	"meddra_code" text,
	"suspected_drug" text NOT NULL,
	"whodrug_code" text,
	"event_date" timestamp with time zone NOT NULL,
	"seriousness" "ae_seriousness" NOT NULL,
	"outcome" text,
	"narrative" text,
	"reporter_role" text,
	"status" "adr_status" DEFAULT 'received' NOT NULL,
	"assessment_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
