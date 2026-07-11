ALTER TYPE "public"."claim_status" ADD VALUE 'assessment' BEFORE 'investigating';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "uploaded_by_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;