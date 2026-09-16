CREATE TABLE "admin_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'ADMIN' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"totp_encrypted" text NOT NULL,
	"last_totp_step" bigint DEFAULT -1 NOT NULL,
	"can_moderate" boolean DEFAULT false NOT NULL,
	"can_suspend" boolean DEFAULT false NOT NULL,
	"can_read_audit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_role_only" CHECK ("admin_accounts"."role" = 'ADMIN'),
	CONSTRAINT "admin_totp_encrypted" CHECK ("admin_accounts"."totp_encrypted" ~ '^v1[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$'),
	CONSTRAINT "admin_totp_step_valid" CHECK ("admin_accounts"."last_totp_step" >= -1)
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mfa_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_hash_valid" CHECK ("admin_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "admin_sessions_lifetime" CHECK ("admin_sessions"."expires_at" > "admin_sessions"."created_at" AND "admin_sessions"."expires_at" <= "admin_sessions"."created_at" + interval '1 hour')
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" uuid,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_fields_bounded" CHECK (length("audit_logs"."actor") BETWEEN 1 AND 160 AND length("audit_logs"."action") BETWEEN 1 AND 80 AND length("audit_logs"."resource") BETWEEN 1 AND 80),
	CONSTRAINT "audit_result_valid" CHECK ("audit_logs"."result" IN ('SUCCESS','DENIED','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"submitted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "moderation_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"case_id" uuid,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" "shop_status" NOT NULL,
	"to_status" "shop_status" NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_action_valid" CHECK ("moderation_history"."action" IN ('SUBMIT','APPROVE','REQUEST_CHANGES','REJECT','SUSPEND')),
	CONSTRAINT "moderation_reason_valid" CHECK (length("moderation_history"."reason") <= 2000 AND ("moderation_history"."action" NOT IN ('REQUEST_CHANGES','REJECT','SUSPEND') OR length(btrim("moderation_history"."reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD CONSTRAINT "admin_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_admin_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_accounts"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_hash_unique" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "admin_sessions_expiry_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_logs" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_shop_idx" ON "moderation_cases" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_one_open_case" ON "moderation_cases" USING btree ("shop_id") WHERE "moderation_cases"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "moderation_history_shop_idx" ON "moderation_history" USING btree ("shop_id","created_at","id");
--> statement-breakpoint
CREATE FUNCTION qrg_immutable_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only' USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION qrg_immutable_audit();
--> statement-breakpoint
CREATE TRIGGER moderation_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON moderation_history FOR EACH STATEMENT EXECUTE FUNCTION qrg_immutable_audit();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, moderation_history FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER admin_accounts_updated_at BEFORE UPDATE ON admin_accounts FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER admin_sessions_updated_at BEFORE UPDATE ON admin_sessions FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
