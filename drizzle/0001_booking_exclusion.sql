-- Makes double booking impossible at the database level: two bookings on the
-- same printer cannot have overlapping slots while either is holding the printer.
-- btree_gist is a trusted extension (PG13+), so the database owner can create it.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "printq"."bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist ("printer_id" WITH =, "slot" WITH &&)
  WHERE ("status" IN ('pending', 'approved', 'checked_in', 'printing'));
--> statement-breakpoint
ALTER TABLE "printq"."bookings"
  ADD CONSTRAINT "bookings_slot_valid"
  CHECK (NOT isempty("slot") AND lower_inc("slot") AND NOT upper_inc("slot"));
--> statement-breakpoint
ALTER TABLE "printq"."lab_hours"
  ADD CONSTRAINT "lab_hours_valid"
  CHECK ("weekday" BETWEEN 0 AND 6 AND "closes_at" > "opens_at");
