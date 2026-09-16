CREATE TABLE "product_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_drafts_version_valid" CHECK ("product_drafts"."version" > 0),
	CONSTRAINT "product_drafts_content_object" CHECK (jsonb_typeof("product_drafts"."content") = 'object' AND octet_length("product_drafts"."content"::text) <= 40000)
);
--> statement-breakpoint
ALTER TABLE "product_drafts" ADD CONSTRAINT "product_drafts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_drafts" ADD CONSTRAINT "product_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_drafts" ADD CONSTRAINT "product_drafts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_drafts_owner_idx" ON "product_drafts" USING btree ("shop_id","user_id","updated_at");