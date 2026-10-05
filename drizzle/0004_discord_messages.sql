CREATE TYPE "printq"."discord_message_kind" AS ENUM('card', 'board', 'public_board');--> statement-breakpoint
CREATE TABLE "printq"."discord_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "printq"."discord_message_kind" NOT NULL,
	"booking_id" uuid,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "printq"."notifications" ADD COLUMN "components" jsonb;--> statement-breakpoint
ALTER TABLE "printq"."discord_messages" ADD CONSTRAINT "discord_messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "printq"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_messages_card_idx" ON "printq"."discord_messages" USING btree ("booking_id") WHERE "printq"."discord_messages"."kind" = 'card';--> statement-breakpoint
CREATE UNIQUE INDEX "discord_messages_board_idx" ON "printq"."discord_messages" USING btree ("kind") WHERE "printq"."discord_messages"."kind" <> 'card';