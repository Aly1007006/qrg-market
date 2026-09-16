CREATE TYPE "public"."subscription_status" AS ENUM('ACTIVE', 'PAST_DUE', 'GRACE', 'SUSPENDED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"amount_minor" integer DEFAULT 1000000 NOT NULL,
	"currency" text DEFAULT 'KZT' NOT NULL,
	"provider" text,
	"provider_payment_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_fixed_amount" CHECK ("payment_attempts"."amount_minor"=1000000 AND "payment_attempts"."currency"='KZT' AND "payment_attempts"."cycle">=0),
	CONSTRAINT "attempt_kind_valid" CHECK ("payment_attempts"."kind" IN ('INITIAL','RENEWAL','RETRY')),
	CONSTRAINT "attempt_outcome_valid" CHECK (("payment_attempts"."status"='PENDING' AND "payment_attempts"."completed_at" IS NULL AND "payment_attempts"."provider" IS NULL AND "payment_attempts"."provider_payment_id" IS NULL) OR ("payment_attempts"."status" IN ('SUCCEEDED','FAILED') AND "payment_attempts"."completed_at" IS NOT NULL AND "payment_attempts"."provider" IS NOT NULL AND "payment_attempts"."provider_payment_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_payment_values" CHECK ("subscription_payments"."amount_minor"=1000000 AND "subscription_payments"."currency"='KZT' AND "subscription_payments"."period_end">"subscription_payments"."period_start")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"plan" text DEFAULT 'QRG_BUSINESS' NOT NULL,
	"amount_minor" integer DEFAULT 1000000 NOT NULL,
	"currency" text DEFAULT 'KZT' NOT NULL,
	"status" "subscription_status" DEFAULT 'SUSPENDED' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"anchor_day" integer,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"next_payment_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"cycle" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_fixed_plan" CHECK ("subscriptions"."plan"='QRG_BUSINESS' AND "subscriptions"."amount_minor"=1000000 AND "subscriptions"."currency"='KZT'),
	CONSTRAINT "subscription_period_valid" CHECK (("subscriptions"."period_start" IS NULL AND "subscriptions"."period_end" IS NULL AND "subscriptions"."anchor_day" IS NULL) OR ("subscriptions"."period_start" IS NOT NULL AND "subscriptions"."period_end" IS NOT NULL AND "subscriptions"."anchor_day" IS NOT NULL AND "subscriptions"."period_end" > "subscriptions"."period_start" AND "subscriptions"."anchor_day" BETWEEN 1 AND 31)),
	CONSTRAINT "subscription_paid_status_period" CHECK ("subscriptions"."status" NOT IN ('ACTIVE','PAST_DUE','GRACE') OR ("subscriptions"."period_start" IS NOT NULL AND "subscriptions"."period_end" IS NOT NULL)),
	CONSTRAINT "subscription_state_dates" CHECK (("subscriptions"."status"<>'GRACE' OR "subscriptions"."grace_ends_at" IS NOT NULL) AND ("subscriptions"."status"<>'PAST_DUE' OR "subscriptions"."next_payment_at" IS NOT NULL) AND (NOT "subscriptions"."cancel_at_period_end" OR NOT "subscriptions"."auto_renew")),
	CONSTRAINT "subscription_revision_valid" CHECK ("subscriptions"."cycle">=0 AND "subscriptions"."version">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_association_unique" ON "payment_attempts" USING btree ("id","subscription_id");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_attempt_id_subscription_id_payment_attempts_id_subscription_id_fk" FOREIGN KEY ("attempt_id","subscription_id") REFERENCES "public"."payment_attempts"("id","subscription_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_idempotency_unique" ON "payment_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_pending_cycle_unique" ON "payment_attempts" USING btree ("subscription_id","cycle") WHERE "payment_attempts"."status"='PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_provider_payment_unique" ON "payment_attempts" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "attempt_history_idx" ON "payment_attempts" USING btree ("subscription_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_provider_unique" ON "subscription_payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_attempt_unique" ON "subscription_payments" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "subscription_payment_history_idx" ON "subscription_payments" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_shop_unique" ON "subscriptions" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "subscriptions_due_idx" ON "subscriptions" USING btree ("status","next_payment_at");--> statement-breakpoint
CREATE INDEX "subscriptions_grace_idx" ON "subscriptions" USING btree ("grace_ends_at");
--> statement-breakpoint
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER payment_attempts_updated_at BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
