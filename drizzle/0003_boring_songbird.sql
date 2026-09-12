CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"meaning" text NOT NULL,
	"payload_hash" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
