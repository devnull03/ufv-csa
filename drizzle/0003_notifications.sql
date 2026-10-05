CREATE TYPE "printq"."notification_delivery" AS ENUM('outbox', 'discord', 'failed');--> statement-breakpoint
CREATE TABLE "printq"."notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"booking_id" uuid,
	"recipient_user_id" text,
	"recipient_discord_id" text,
	"channel_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"delivery" "printq"."notification_delivery" DEFAULT 'outbox' NOT NULL,
	"error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "printq"."notifications" ADD CONSTRAINT "notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "printq"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printq"."notifications" ADD CONSTRAINT "notifications_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "printq"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "printq"."notifications" USING btree ("created_at");