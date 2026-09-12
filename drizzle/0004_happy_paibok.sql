CREATE TABLE "monitoring_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_site_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"scheduled_date" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"summary" text,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_visits" ADD CONSTRAINT "monitoring_visits_trial_site_id_trial_sites_id_fk" FOREIGN KEY ("trial_site_id") REFERENCES "public"."trial_sites"("id") ON DELETE no action ON UPDATE no action;