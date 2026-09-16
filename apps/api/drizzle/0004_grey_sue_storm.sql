CREATE TYPE "public"."customer_request_status" AS ENUM('NEW', 'VIEWED', 'CONTACTED', 'CONFIRMED', 'CLOSED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "customer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"product_name" text NOT NULL,
	"variant_label" text DEFAULT '' NOT NULL,
	"quantity" integer NOT NULL,
	"pickup_preference" text,
	"comment" text,
	"consent_type" text DEFAULT 'PRIVACY' NOT NULL,
	"consent_version" text NOT NULL,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "customer_request_status" DEFAULT 'NEW' NOT NULL,
	"submission_hash" text NOT NULL,
	"dedup_hash" text NOT NULL,
	"status_changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_name_valid" CHECK (length(btrim("customer_requests"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "requests_phone_valid" CHECK ("customer_requests"."phone" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "requests_quantity_valid" CHECK ("customer_requests"."quantity" BETWEEN 1 AND 99),
	CONSTRAINT "requests_text_limits" CHECK (length("customer_requests"."product_name") BETWEEN 1 AND 200 AND length("customer_requests"."variant_label") <= 200 AND ("customer_requests"."comment" IS NULL OR length("customer_requests"."comment") <= 1000)),
	CONSTRAINT "requests_pickup_valid" CHECK ("customer_requests"."pickup_preference" IS NULL OR "customer_requests"."pickup_preference" IN ('SHOP_PICKUP','DISCUSS_WITH_SELLER')),
	CONSTRAINT "requests_consent_valid" CHECK ("customer_requests"."consent_type" = 'PRIVACY' AND length("customer_requests"."consent_version") BETWEEN 1 AND 100),
	CONSTRAINT "requests_hashes_valid" CHECK ("customer_requests"."submission_hash" ~ '^[0-9a-f]{64}$' AND "customer_requests"."dedup_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "variants_id_product_shop_unique" ON "product_variants" USING btree ("id","product_id","shop_id");--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_product_id_shop_id_products_id_shop_id_fk" FOREIGN KEY ("product_id","shop_id") REFERENCES "public"."products"("id","shop_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_variant_id_product_id_shop_id_product_variants_id_product_id_shop_id_fk" FOREIGN KEY ("variant_id","product_id","shop_id") REFERENCES "public"."product_variants"("id","product_id","shop_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_shop_created_idx" ON "customer_requests" USING btree ("shop_id","created_at","id");--> statement-breakpoint
CREATE INDEX "requests_shop_status_idx" ON "customer_requests" USING btree ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "requests_product_idx" ON "customer_requests" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "requests_variant_idx" ON "customer_requests" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "requests_actor_idx" ON "customer_requests" USING btree ("status_changed_by");--> statement-breakpoint
CREATE INDEX "requests_dedup_idx" ON "customer_requests" USING btree ("dedup_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_submission_unique" ON "customer_requests" USING btree ("submission_hash");--> statement-breakpoint
CREATE TRIGGER customer_requests_updated_at BEFORE UPDATE ON customer_requests FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
