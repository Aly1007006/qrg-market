CREATE TABLE "seller_onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_images_kind_valid" CHECK ("shop_images"."kind" IN ('logo','cover')),
	CONSTRAINT "shop_images_dimensions_valid" CHECK ("shop_images"."width" BETWEEN 1 AND 12000 AND "shop_images"."height" BETWEEN 1 AND 12000),
	CONSTRAINT "shop_images_key_valid" CHECK ("shop_images"."object_key" ~ '^shops/[0-9a-f-]{36}/[0-9a-f-]{36}[.]webp$' AND split_part("shop_images"."object_key",'/',2)="shop_images"."shop_id"::text)
);
--> statement-breakpoint
ALTER TABLE "media_objects" DROP CONSTRAINT "media_key_valid";--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
ALTER TABLE "seller_onboarding" ADD CONSTRAINT "seller_onboarding_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_onboarding" ADD CONSTRAINT "seller_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_images" ADD CONSTRAINT "shop_images_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_onboarding_subject_unique" ON "seller_onboarding" USING btree ("shop_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_images_kind_unique" ON "shop_images" USING btree ("shop_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_images_key_unique" ON "shop_images" USING btree ("object_key");--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_key_valid" CHECK ("media_objects"."object_key" ~ '^(products|shops)/[0-9a-f-]{36}/[0-9a-f-]{36}[.](webp|avif)$');