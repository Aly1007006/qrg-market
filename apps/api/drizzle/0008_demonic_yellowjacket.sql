CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_type_valid" CHECK ("analytics_events"."type" IN ('SHOP_VIEW','PRODUCT_VIEW','WHATSAPP_CLICK','TWO_GIS_CLICK','CUSTOMER_REQUEST_CREATED')),
	CONSTRAINT "analytics_resource_valid" CHECK (("analytics_events"."type"<>'SHOP_VIEW' OR "analytics_events"."product_id" IS NULL) AND ("analytics_events"."type" NOT IN ('PRODUCT_VIEW','CUSTOMER_REQUEST_CREATED') OR "analytics_events"."product_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_product_id_shop_id_products_id_shop_id_fk" FOREIGN KEY ("product_id","shop_id") REFERENCES "public"."products"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_replay_unique" ON "analytics_events" USING btree ("type","event_id");--> statement-breakpoint
CREATE INDEX "analytics_shop_time_idx" ON "analytics_events" USING btree ("shop_id","created_at","type");--> statement-breakpoint
CREATE INDEX "analytics_product_time_idx" ON "analytics_events" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_retention_idx" ON "analytics_events" USING btree ("created_at");
--> statement-breakpoint
CREATE FUNCTION qrg_request_analytics() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO analytics_events(event_id,type,shop_id,product_id,created_at)
  VALUES (NEW.id,'CUSTOMER_REQUEST_CREATED',NEW.shop_id,NEW.product_id,NEW.created_at)
  ON CONFLICT (type,event_id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER request_analytics_created AFTER INSERT ON customer_requests
FOR EACH ROW EXECUTE FUNCTION qrg_request_analytics();
