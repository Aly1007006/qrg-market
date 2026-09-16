ALTER TABLE "admin_accounts" DROP CONSTRAINT "admin_role_only";--> statement-breakpoint
ALTER TABLE "admin_accounts" DROP CONSTRAINT "admin_totp_encrypted";--> statement-breakpoint
ALTER TABLE "admin_accounts" ALTER COLUMN "totp_encrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_sessions" ALTER COLUMN "mfa_verified_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD COLUMN "pending_totp_encrypted" text;--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD COLUMN "recovery_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "moderation_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "moderation_previous_status" "product_status";--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD CONSTRAINT "admin_role_only" CHECK ("admin_accounts"."role" IN ('ADMIN', 'SUPER_ADMIN', 'MODERATION_ADMIN', 'SUPPORT_ADMIN', 'FINANCE_ADMIN'));--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD CONSTRAINT "admin_totp_encrypted" CHECK ("admin_accounts"."totp_encrypted" IS NULL OR "admin_accounts"."totp_encrypted" ~ '^v1[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$');--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_moderation_visibility" CHECK (NOT "products"."moderation_hidden" OR "products"."status" <> 'PUBLISHED');