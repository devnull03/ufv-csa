import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Notification hooks in demo mode: everything lands in the outbox, deduplicated.
const databaseUrl = process.env.PRINTQ_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("notification hooks (Postgres, demo mode)", () => {
  let mod: {
    notify: typeof import("../notify");
    lab: typeof import("../lab-status");
    jobs: typeof import("../jobs");
    client: typeof import("../db/client");
    schema: typeof import("../db/schema");
    telemetry: typeof import("../telemetry");
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "x".repeat(32),
      SITE_DOMAIN: "localhost:3000",
      PRINTQ_DEMO: "true",
      PRINTQ_CRON_SECRET: "y".repeat(32),
      PRINTQ_UPLOAD_DIR: "/tmp/printq-notify-test",
    });
    mod = {
      notify: await import("../notify"),
      lab: await import("../lab-status"),
      jobs: await import("../jobs"),
      client: await import("../db/client"),
      schema: await import("../db/schema"),
      telemetry: await import("../telemetry"),
    };
  });

  beforeEach(async () => {
    await mod.client.db().execute(
      sql`TRUNCATE printq.discord_messages, printq.notifications, printq.booking_events, printq.bookings, printq.uploads, printq.settings,
        printq.printers, printq.profiles, printq.account, printq."user" CASCADE`
    );
  });

  async function approvedBookingIn(minutes: number) {
    const database = mod.client.db();
    const { schema } = mod;
    await database.insert(schema.user).values({ id: "maya", name: "Maya", email: "1@discord.invalid" });
    await database.insert(schema.profiles).values({ userId: "maya", discordId: "900000000000000001", isGuildMember: true, hasVerifiedRole: true });
    const [printer] = await database.insert(schema.printers).values({ name: "Prusa MK4S", model: "MK4S", bedX: 250, bedY: 210, bedZ: 220 }).returning();
    const [upload] = await database
      .insert(schema.uploads)
      .values({
        ownerId: "maya",
        storageKey: "gcode/00000000-0000-4000-8000-0000000000bb.bgcode",
        originalName: "a.bgcode",
        sizeBytes: 1,
        sha256: "x",
        summary: { format: "bgcode", printSeconds: 3600, filamentGrams: 5, filamentType: "PLA", printerModel: "MK4S", bbox: null, hasThumbnail: false },
      })
      .returning();
    const start = new Date(Date.now() + minutes * 60_000);
    const [booking] = await database
      .insert(schema.bookings)
      .values({ printerId: printer.id, ownerId: "maya", uploadId: upload.id, title: "Clip", status: "approved", slot: { start, end: new Date(start.getTime() + 3_600_000) } })
      .returning();
    return booking;
  }

  const outbox = () => mod.client.db().select().from(mod.schema.notifications).orderBy(mod.schema.notifications.id);

  it("records request and decision messages in the outbox", async () => {
    const booking = await approvedBookingIn(300);
    await mod.notify.onBookingRequested(booking);
    await mod.notify.onBookingTransition(booking, "approve", "staff", undefined);
    const rows = (await outbox()).filter((row) => row.kind !== "card_log");
    expect(rows.map((row) => row.kind)).toEqual(["request_received", "booking_approve"]);
    expect(rows.every((row) => row.delivery === "outbox")).toBe(true);
    expect(rows[0].recipientDiscordId).toBe("900000000000000001");
    // The staff channel gets one card, edited in place, with a log line per change.
    const cards = await mod.client.db().select().from(mod.schema.discordMessages);
    expect(cards.filter((row) => row.kind === "card")).toHaveLength(1);
    const logs = (await outbox()).filter((row) => row.kind === "card_log").map((row) => row.title);
    // Maya has no Discord username in this fixture, and the "staff" actor doesn't exist.
    expect(logs).toEqual(["📥 Requested by Maya", "✅ Approved by someone"]);
  });

  it("sends each reminder once, however often the jobs run", async () => {
    await approvedBookingIn(30);
    await mod.jobs.runJobs();
    await mod.jobs.runJobs();
    expect((await outbox()).map((row) => row.kind)).toEqual(["reminder_1h"]);
  });

  it("tells today's members when the lab opens, once per day", async () => {
    // The booking must start later today (Vancouver time); skip in the last minutes before midnight.
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    const minuteOfDay = Number(local.find((p) => p.type === "hour")!.value) * 60 + Number(local.find((p) => p.type === "minute")!.value);
    if (minuteOfDay > 23 * 60 + 50) return;
    const booking = await approvedBookingIn(5);
    await mod.lab.setLabStatus(true, "maya");
    await mod.lab.setLabStatus(false, "maya");
    await mod.lab.setLabStatus(true, "maya");
    const opened = (await outbox()).filter((row) => row.kind === "lab_opened");
    expect(opened).toHaveLength(1);
    expect(opened[0].bookingId).toBe(booking.id);
    expect((await mod.lab.getLabStatus()).open).toBe(true);
  });

  it("simulates printer telemetry in demo mode", () => {
    expect(mod.telemetry.getPrinterTelemetry(true)).toMatchObject({ simulated: true, bed: { value: "60 °C" } });
    expect(mod.telemetry.getPrinterTelemetry(false).nozzle.sub).toBe("Idle");
  });
});
