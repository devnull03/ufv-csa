import "server-only";
import { and, inArray, isNull, lt, notExists, eq } from "drizzle-orm";
import { SLOT_HOLDING_STATUSES } from "./constants";
import { expireHolds } from "./bookings";
import { db, schema } from "./db/client";
import { diskStore } from "./files";
import { getSettings } from "./settings";

export interface JobReport {
  expiredHolds: string[];
  purgedUploads: number;
  remindersSent: number;
}

/** Everything periodic, run by POST /api/printq/cron (systemd timer every 5 minutes). */
export async function runJobs(now = new Date()): Promise<JobReport> {
  const expiredHolds = await expireHolds(db(), now);
  const purgedUploads = await purgeOldUploads(now);
  // TODO(phase 3): 24 h / 1 h reminders, no-show after grace, hold-expired DMs.
  return { expiredHolds, purgedUploads, remindersSent: 0 };
}

async function purgeOldUploads(now: Date) {
  const { fileRetentionDays } = await getSettings();
  const cutoff = new Date(now.getTime() - fileRetentionDays * 86_400_000);
  const database = db();
  const stale = await database
    .select({ id: schema.uploads.id, storageKey: schema.uploads.storageKey })
    .from(schema.uploads)
    .where(
      and(
        isNull(schema.uploads.purgedAt),
        lt(schema.uploads.createdAt, cutoff),
        notExists(
          database
            .select({ id: schema.bookings.id })
            .from(schema.bookings)
            .where(
              and(
                eq(schema.bookings.uploadId, schema.uploads.id),
                inArray(schema.bookings.status, [...SLOT_HOLDING_STATUSES, "finished"])
              )
            )
        )
      )
    );

  const store = diskStore();
  for (const upload of stale) {
    // Keep the thumbnail for history; drop the G-code itself.
    await store.remove(upload.storageKey);
    await database.update(schema.uploads).set({ purgedAt: now }).where(eq(schema.uploads.id, upload.id));
  }
  return stale.length;
}
