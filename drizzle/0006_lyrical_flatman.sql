ALTER TYPE "public"."claim_status" ADD VALUE 'finalized' BEFORE 'approved';--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "finalized_at" timestamp with time zone;