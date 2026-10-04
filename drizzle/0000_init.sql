CREATE SCHEMA "printq";
--> statement-breakpoint
CREATE TYPE "printq"."booking_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'cancelled', 'checked_in', 'printing', 'finished', 'collected', 'no_show', 'failed', 'lab_closed');--> statement-breakpoint
CREATE TYPE "printq"."closure_kind" AS ENUM('closure', 'maintenance');--> statement-breakpoint
CREATE TYPE "printq"."printer_status" AS ENUM('active', 'maintenance', 'retired');--> statement-breakpoint
CREATE TYPE "printq"."user_role" AS ENUM('member', 'staff', 'admin');--> statement-breakpoint
CREATE TABLE "printq"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printq"."booking_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"from_status" "printq"."booking_status",
	"to_status" "printq"."booking_status",
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printq"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printer_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"upload_id" uuid NOT NULL,
	"slot" "tstzrange" NOT NULL,
	"status" "printq"."booking_status" DEFAULT 'pending' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"notes" text,
	"model_url" text,
	"decision_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printq"."closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printer_id" uuid,
	"kind" "printq"."closure_kind" DEFAULT 'closure' NOT NULL,
	"during" "tstzrange" NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printq"."lab_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printer_id" uuid,
	"weekday" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printq"."printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"model" text NOT NULL,
	"bed_x_mm" integer NOT NULL,
	"bed_y_mm" integer NOT NULL,
	"bed_z_mm" integer NOT NULL,
	"status" "printq"."printer_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printq"."profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"discord_username" text,
	"role" "printq"."user_role" DEFAULT 'member' NOT NULL,
	"is_guild_member" boolean DEFAULT false NOT NULL,
	"has_verified_role" boolean DEFAULT false NOT NULL,
	"eligibility_checked_at" timestamp with time zone,
	"banned_until" timestamp with time zone,
	"ban_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "printq"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "printq"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "printq"."uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"summary" jsonb NOT NULL,
	"thumbnail_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "uploads_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "printq"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "printq"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "printq"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "printq"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "printq"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."booking_events" ADD CONSTRAINT "booking_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "printq"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."bookings" ADD CONSTRAINT "bookings_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "printq"."printers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."bookings" ADD CONSTRAINT "bookings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "printq"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."bookings" ADD CONSTRAINT "bookings_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "printq"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."bookings" ADD CONSTRAINT "bookings_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "printq"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."closures" ADD CONSTRAINT "closures_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "printq"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."closures" ADD CONSTRAINT "closures_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "printq"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."lab_hours" ADD CONSTRAINT "lab_hours_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "printq"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "printq"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "printq"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."settings" ADD CONSTRAINT "settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "printq"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."uploads" ADD CONSTRAINT "uploads_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "printq"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "printq"."booking_events" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "bookings_owner_idx" ON "printq"."bookings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "printq"."bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "closures_during_idx" ON "printq"."closures" USING gist ("during");