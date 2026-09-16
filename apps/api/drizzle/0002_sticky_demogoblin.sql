CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_name_valid" CHECK (length(btrim("brands"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "brands_slug_valid" CHECK ("brands"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("brands"."slug") <= 100)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_valid" CHECK (length(btrim("categories"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "categories_slug_valid" CHECK ("categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("categories"."slug") <= 100),
	CONSTRAINT "categories_not_self" CHECK ("categories"."parent_id" IS NULL OR "categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "images_position_limit" CHECK ("product_images"."position" BETWEEN 0 AND 9),
	CONSTRAINT "images_dimensions_valid" CHECK ("product_images"."width" BETWEEN 1 AND 12000 AND "product_images"."height" BETWEEN 1 AND 12000),
	CONSTRAINT "images_alt_limit" CHECK (length("product_images"."alt") <= 300),
	CONSTRAINT "images_key_valid" CHECK ("product_images"."object_key" ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}[.](webp|avif)$' AND split_part("product_images"."object_key",'/',2) = "product_images"."product_id"::text)
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"size" text,
	"color" text,
	"sku" text,
	"price_override" numeric(12, 2),
	"availability" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variants_price_valid" CHECK ("product_variants"."price_override" IS NULL OR "product_variants"."price_override" BETWEEN 0 AND 99999999.99),
	CONSTRAINT "variants_text_valid" CHECK (("product_variants"."size" IS NULL OR length(btrim("product_variants"."size")) BETWEEN 1 AND 40) AND ("product_variants"."color" IS NULL OR length(btrim("product_variants"."color")) BETWEEN 1 AND 40) AND ("product_variants"."sku" IS NULL OR length(btrim("product_variants"."sku")) BETWEEN 1 AND 100))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"brand_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"base_price" numeric(12, 2) NOT NULL,
	"old_price" numeric(12, 2),
	"status" "product_status" DEFAULT 'DRAFT' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian', search_text) || to_tsvector('simple', search_text)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_name_valid" CHECK (length(btrim("products"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "products_description_limit" CHECK (length("products"."description") <= 10000),
	CONSTRAINT "products_slug_valid" CHECK ("products"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("products"."slug") <= 120),
	CONSTRAINT "products_price_valid" CHECK ("products"."base_price" BETWEEN 0 AND 99999999.99 AND ("products"."old_price" IS NULL OR ("products"."old_price" > "products"."base_price" AND "products"."old_price" <= 99999999.99)))
);
--> statement-breakpoint
CREATE TABLE "shop_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"phone" text,
	"whatsapp_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_phone_valid" CHECK (("shop_contacts"."phone" IS NULL OR "shop_contacts"."phone" ~ '^[+][1-9][0-9]{7,14}$') AND ("shop_contacts"."whatsapp_phone" IS NULL OR "shop_contacts"."whatsapp_phone" ~ '^[+][1-9][0-9]{7,14}$'))
);
--> statement-breakpoint
CREATE TABLE "shop_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"city" text DEFAULT 'Караганда' NOT NULL,
	"address" text NOT NULL,
	"mall" text,
	"two_gis_url" text,
	"two_gis_firm_id" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"geo" geometry(Point,4326) GENERATED ALWAYS AS (CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision),4326) ELSE NULL END) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_address_valid" CHECK (length(btrim("shop_locations"."address")) BETWEEN 1 AND 300 AND length("shop_locations"."city") BETWEEN 1 AND 100 AND ("shop_locations"."mall" IS NULL OR length(btrim("shop_locations"."mall")) BETWEEN 1 AND 150)),
	CONSTRAINT "locations_coordinates_valid" CHECK (("shop_locations"."latitude" IS NULL AND "shop_locations"."longitude" IS NULL) OR ("shop_locations"."latitude" IS NOT NULL AND "shop_locations"."longitude" IS NOT NULL AND "shop_locations"."latitude" BETWEEN -90 AND 90 AND "shop_locations"."longitude" BETWEEN -180 AND 180)),
	CONSTRAINT "locations_2gis_valid" CHECK (("shop_locations"."two_gis_url" IS NULL AND "shop_locations"."two_gis_firm_id" IS NULL) OR ("shop_locations"."two_gis_url" IS NOT NULL AND "shop_locations"."two_gis_firm_id" IS NOT NULL AND "shop_locations"."two_gis_url" ~ '^https://2gis[.]kz/karaganda/firm/[0-9]{10,20}$' AND "shop_locations"."two_gis_url" = 'https://2gis.kz/karaganda/firm/' || "shop_locations"."two_gis_firm_id"))
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "slug" text DEFAULT 'shop-' || gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_id_shop_unique" ON "products" USING btree ("id","shop_id");--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_shop_id_products_id_shop_id_fk" FOREIGN KEY ("product_id","shop_id") REFERENCES "public"."products"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_contacts" ADD CONSTRAINT "shop_contacts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_locations" ADD CONSTRAINT "shop_locations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_unique" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_unique" ON "brands" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_unique" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "images_object_key_unique" ON "product_images" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "images_product_position_unique" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_shop_sku_unique" ON "product_variants" USING btree ("shop_id","sku") WHERE "product_variants"."sku" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "variants_options_unique" ON "product_variants" USING btree ("product_id",coalesce("size",''),coalesce("color",''));--> statement-breakpoint
CREATE INDEX "variants_filters_idx" ON "product_variants" USING btree ("size","color","availability","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_unique" ON "products" USING btree ("slug");--> statement-breakpoint

CREATE INDEX "products_shop_idx" ON "products" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_public_price_idx" ON "products" USING btree ("base_price","id") WHERE "products"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "products_public_new_idx" ON "products" USING btree ("created_at","id") WHERE "products"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "products_fts_idx" ON "products" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "products_trgm_idx" ON "products" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_shop_unique" ON "shop_contacts" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_shop_unique" ON "shop_locations" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "locations_mall_idx" ON "shop_locations" USING btree ("mall");--> statement-breakpoint
CREATE INDEX "locations_geo_idx" ON "shop_locations" USING gist ("geo");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_slug_unique" ON "shops" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_slug_format" CHECK ("shops"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("shops"."slug") <= 120);
--> statement-breakpoint
CREATE FUNCTION qrg_product_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT lower(concat_ws(' ',NEW.name,NEW.description,c.name,pc.name,b.name,s.name))
 INTO NEW.search_text FROM categories c LEFT JOIN categories pc ON pc.id=c.parent_id
 JOIN shops s ON s.id=NEW.shop_id LEFT JOIN brands b ON b.id=NEW.brand_id WHERE c.id=NEW.category_id;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER products_search BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION qrg_product_search();
--> statement-breakpoint
CREATE FUNCTION qrg_refresh_product_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='shops' THEN UPDATE products SET name=name WHERE shop_id=NEW.id;
 ELSIF TG_TABLE_NAME='brands' THEN UPDATE products SET name=name WHERE brand_id=NEW.id;
 ELSE UPDATE products SET name=name WHERE category_id=NEW.id OR category_id IN (SELECT id FROM categories WHERE parent_id=NEW.id);
 END IF;
 RETURN NULL;
END; $$;
--> statement-breakpoint
CREATE TRIGGER shops_search AFTER UPDATE OF name ON shops FOR EACH ROW WHEN(OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION qrg_refresh_product_search();
--> statement-breakpoint
CREATE TRIGGER brands_search AFTER UPDATE OF name ON brands FOR EACH ROW WHEN(OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION qrg_refresh_product_search();
--> statement-breakpoint
CREATE TRIGGER categories_search AFTER UPDATE OF name,parent_id ON categories FOR EACH ROW EXECUTE FUNCTION qrg_refresh_product_search();
--> statement-breakpoint
CREATE FUNCTION qrg_category_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Reference taxonomy is operator-managed; serialize structural changes.
 PERFORM pg_advisory_xact_lock(71624702);
 IF NEW.parent_id IS NOT NULL AND (EXISTS(SELECT 1 FROM categories WHERE id=NEW.parent_id AND parent_id IS NOT NULL) OR EXISTS(SELECT 1 FROM categories WHERE parent_id=NEW.id)) THEN
 RAISE EXCEPTION 'Only category and subcategory are supported' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER categories_depth BEFORE INSERT OR UPDATE OF parent_id ON categories FOR EACH ROW EXECUTE FUNCTION qrg_category_depth();

--> statement-breakpoint
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER brands_updated_at BEFORE UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_variants_updated_at BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_images_updated_at BEFORE UPDATE ON product_images FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER shop_locations_updated_at BEFORE UPDATE ON shop_locations FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER shop_contacts_updated_at BEFORE UPDATE ON shop_contacts FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
INSERT INTO categories(name,slug) VALUES ('Женщинам','women'),('Мужчинам','men'),('Обувь','shoes'),('Аксессуары','accessories'),('Красота','beauty');
