CREATE TYPE "public"."merchant_rule_source" AS ENUM('LEARNED', 'MANUAL');--> statement-breakpoint
CREATE TABLE "merchant_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL,
	"subcategory_id" uuid,
	"source" "merchant_rule_source" DEFAULT 'LEARNED' NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_rules_pattern_not_blank" CHECK (length(btrim("merchant_rules"."pattern")) > 0)
);
--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_subcategory_id_categories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rules_unique" ON "merchant_rules" USING btree ("user_id","pattern");--> statement-breakpoint
CREATE INDEX "merchant_rules_user_idx" ON "merchant_rules" USING btree ("user_id","hit_count");