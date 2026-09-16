CREATE SEQUENCE "public"."halyk_invoice_sequence" INCREMENT BY 1 MINVALUE 100000 MAXVALUE 999999 START WITH 100000 CACHE 1;--> statement-breakpoint
CREATE TABLE "payment_provider_bindings" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"invoice_id" text DEFAULT nextval('halyk_invoice_sequence')::text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_binding_provider_valid" CHECK ("payment_provider_bindings"."provider" = 'halyk'),
	CONSTRAINT "provider_binding_environment_valid" CHECK ("payment_provider_bindings"."environment" IN ('sandbox','production')),
	CONSTRAINT "provider_binding_invoice_valid" CHECK ("payment_provider_bindings"."invoice_id" ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
ALTER TABLE "payment_provider_bindings" ADD CONSTRAINT "payment_provider_bindings_attempt_id_subscription_id_payment_attempts_id_subscription_id_fk" FOREIGN KEY ("attempt_id","subscription_id") REFERENCES "public"."payment_attempts"("id","subscription_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_binding_invoice_unique" ON "payment_provider_bindings" USING btree ("provider","environment","merchant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "provider_binding_subscription_idx" ON "payment_provider_bindings" USING btree ("subscription_id");
--> statement-breakpoint
CREATE FUNCTION qrg_reject_payment_binding_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payment invoice bindings are immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_binding_immutable BEFORE UPDATE ON payment_provider_bindings
FOR EACH ROW EXECUTE FUNCTION qrg_reject_payment_binding_update();
