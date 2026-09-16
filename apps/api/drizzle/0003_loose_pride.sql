CREATE TABLE "media_objects" (
	"object_key" text PRIMARY KEY NOT NULL,
	"product_id" uuid,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"retry_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_state_valid" CHECK ("media_objects"."state" IN ('PENDING','ATTACHED','DELETING')),
	CONSTRAINT "media_key_valid" CHECK ("media_objects"."object_key" ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}[.](webp|avif)$')
);
--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_cleanup_idx" ON "media_objects" USING btree ("state","retry_at");--> statement-breakpoint
CREATE INDEX "media_product_idx" ON "media_objects" USING btree ("product_id");