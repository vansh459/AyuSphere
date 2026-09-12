CREATE TYPE "public"."query_status" AS ENUM('open', 'answered', 'closed');--> statement-breakpoint
CREATE TABLE "data_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crf_entry_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" "query_status" DEFAULT 'open' NOT NULL,
	"raised_by" uuid NOT NULL,
	"answered_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_query_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_queries" ADD CONSTRAINT "data_queries_crf_entry_id_crf_entries_id_fk" FOREIGN KEY ("crf_entry_id") REFERENCES "public"."crf_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_query_messages" ADD CONSTRAINT "data_query_messages_query_id_data_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."data_queries"("id") ON DELETE no action ON UPDATE no action;