CREATE TYPE "public"."ingest_source" AS ENUM('STATEMENT', 'EMAIL', 'SMS');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('PENDING', 'IMPORTED', 'IGNORED', 'DUPLICATE');--> statement-breakpoint
CREATE TABLE "ingested_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" "ingest_source" NOT NULL,
	"external_ref" text NOT NULL,
	"account_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"parsed_amount" numeric(14, 2) NOT NULL,
	"parsed_date" date NOT NULL,
	"parsed_merchant" text,
	"suggested_type" "transaction_type" NOT NULL,
	"suggested_category_id" uuid,
	"status" "ingest_status" DEFAULT 'PENDING' NOT NULL,
	"matched_transaction_id" uuid,
	"match_reason" text,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "ingested_items" ADD CONSTRAINT "ingested_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingested_items" ADD CONSTRAINT "ingested_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingested_items" ADD CONSTRAINT "ingested_items_suggested_category_id_categories_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingested_items" ADD CONSTRAINT "ingested_items_matched_transaction_id_transactions_id_fk" FOREIGN KEY ("matched_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingested_items" ADD CONSTRAINT "ingested_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingested_items_ref_unique" ON "ingested_items" USING btree ("user_id","external_ref");--> statement-breakpoint
CREATE INDEX "ingested_items_review_idx" ON "ingested_items" USING btree ("user_id","status","parsed_date");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_external_ref_unique" ON "transactions" USING btree ("user_id","external_ref") WHERE "transactions"."external_ref" is not null;