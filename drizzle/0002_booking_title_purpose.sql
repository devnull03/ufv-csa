CREATE TYPE "printq"."booking_purpose" AS ENUM('course', 'club', 'personal');--> statement-breakpoint
ALTER TABLE "printq"."bookings" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "printq"."bookings" ADD COLUMN "purpose" "printq"."booking_purpose";