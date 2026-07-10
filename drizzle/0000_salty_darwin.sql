CREATE TYPE "public"."claim_status" AS ENUM('intake', 'triage', 'investigating', 'approved', 'denied', 'paid', 'closed', 'reopened', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."deductible_order" AS ENUM('before_limit', 'after_limit');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('police_report', 'damage_photo', 'repair_invoice', 'repair_proof', 'other');--> statement-breakpoint
CREATE TYPE "public"."limit_mode" AS ENUM('per_occurrence', 'aggregate');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('claimant', 'adjuster', 'supervisor');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(100) NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"category" varchar(100) NOT NULL,
	"age_months" integer NOT NULL,
	"claimed_agorot" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_ref" varchar(50) NOT NULL,
	"claimant_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"currency" varchar(3) DEFAULT 'ILS' NOT NULL,
	"date_of_loss" date NOT NULL,
	"status" "claim_status" DEFAULT 'intake' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "claims_claim_ref_unique" UNIQUE("claim_ref")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"doc_type" "document_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"amount_agorot" integer NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	CONSTRAINT "payments_claim_id_idempotency_key_unique" UNIQUE("claim_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_number" varchar(100) NOT NULL,
	"currency" varchar(3) DEFAULT 'ILS' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"deductible_agorot" integer NOT NULL,
	"per_occurrence_limit_agorot" integer NOT NULL,
	"aggregate_limit_agorot" integer NOT NULL,
	"deductible_order" "deductible_order" DEFAULT 'before_limit' NOT NULL,
	"limit_mode" "limit_mode" DEFAULT 'per_occurrence' NOT NULL,
	CONSTRAINT "policies_policy_number_unique" UNIQUE("policy_number")
);
--> statement-breakpoint
CREATE TABLE "recoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"amount_agorot" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reserves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"amount_agorot" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "user_role" NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_id_users_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserves" ADD CONSTRAINT "reserves_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;