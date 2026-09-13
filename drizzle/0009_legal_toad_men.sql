CREATE TYPE "public"."guide_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "guide_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"role" "guide_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "guide_msg_thread_idx" ON "guide_messages" USING btree ("user_id","thread_id","created_at");