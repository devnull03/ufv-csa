import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asciiGcode } from "../gcode/__tests__/fixtures";

// Integration tests against a real Postgres. Skipped unless PRINTQ_TEST_DATABASE_URL
// points at a migrated, disposable database (CI provides one).
const databaseUrl = process.env.PRINTQ_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("booking service (Postgres)", () => {
  let uploadDir: string;
  let mod: {
    bookings: typeof import("../bookings");
    client: typeof import("../db/client");
    schema: typeof import("../db/schema");
  };

  const member = (id: string, role: "member" | "staff" | "admin" = "member") => ({
    userId: id,
    name: id,
    image: null,
    discordId: `1${id.length}0000000000000000`,
    discordUsername: id,
    role,
    ineligibleReason: null,
    bannedUntil: null,
  });
  const alice = member("alice");
  const bob = member("bob");
  const staff = member("staffer", "staff");

  const stream = (text: string) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });

  // A quarter-hour start comfortably past the default 60-minute lead time.
  const nextStart = (hoursAhead: number) => {
    const quarter = 15 * 60_000;
    return new Date(Math.ceil((Date.now() + hoursAhead * 3_600_000) / quarter) * quarter);
  };

  beforeAll(async () => {
    uploadDir = await mkdtemp(path.join(tmpdir(), "printq-uploads-"));
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "x".repeat(32),
      SITE_DOMAIN: "localhost:3000",
      DISCORD_BOT_ID: "100000000000000001",
      DISCORD_BOT_TOKEN: "test",
      DISCORD_CLIENT_SECRET: "test",
      DISCORD_SERVER_ID: "100000000000000002",
      PRINTQ_VERIFIED_ROLE_ID: "100000000000000003",
      PRINTQ_CRON_SECRET: "y".repeat(32),
      PRINTQ_UPLOAD_DIR: uploadDir,
    });
    mod = {
      bookings: await import("../bookings"),
      client: await import("../db/client"),
      schema: await import("../db/schema"),
    };
  });

  afterAll(async () => {
    await rm(uploadDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const { client } = mod;
    await client.db().execute(
      sql`TRUNCATE printq.booking_events, printq.bookings, printq.uploads, printq.closures,
        printq.lab_hours, printq.settings, printq.printers, printq.profiles, printq.session, printq.account,
        printq."user" CASCADE`
    );
    const database = client.db();
    await database.insert(mod.schema.user).values(
      [alice, bob, staff].map((viewer) => ({ id: viewer.userId, name: viewer.name, email: `${viewer.userId}@discord.invalid` }))
    );
    await database.insert(mod.schema.printers).values({ name: "Test MK4S", model: "MK4S", bedX: 250, bedY: 210, bedZ: 220 });
    // Open around the clock so the tests don't depend on the time of day.
    await database
      .insert(mod.schema.labHours)
      .values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" })));
  });

  it("stores an upload, parses it and saves the thumbnail", async () => {
    const upload = await mod.bookings.storeUpload(alice, "benchy.gcode", stream(asciiGcode()));
    expect(upload.summary.printerModel).toBe("MK4S");
    expect(upload.summary.printSeconds).toBe(5025);
    expect(upload.thumbnailKey).toMatch(/^thumbs\/.+\.png$/);
    expect((await stat(path.join(uploadDir, upload.storageKey))).size).toBe(Buffer.byteLength(asciiGcode()));
  });

  it("rejects non-G-code uploads and removes the file", async () => {
    await expect(mod.bookings.storeUpload(alice, "notes.txt", stream("hello"))).rejects.toMatchObject({ code: "unsupported_file" });
    await expect(mod.bookings.storeUpload(alice, "fake.gcode", stream("<html></html>"))).rejects.toMatchObject({
      code: "unsupported_file",
    });
  });

  it("books a free slot, refuses an overlapping one, and walks the lifecycle", async () => {
    const start = nextStart(3);
    const aliceUpload = await mod.bookings.storeUpload(alice, "a.gcode", stream(asciiGcode()));
    const booking = await mod.bookings.createBooking(alice, { uploadId: aliceUpload.id, start });
    expect(booking.status).toBe("pending");
    // 5025 s = 83.75 min, +10% = 92.1, +15 buffer = 107.1, rounded up to 120 minutes.
    expect(booking.slot.end.getTime() - booking.slot.start.getTime()).toBe(120 * 60_000);

    const bobUpload = await mod.bookings.storeUpload(bob, "b.gcode", stream(asciiGcode()));
    await expect(
      mod.bookings.createBooking(bob, { uploadId: bobUpload.id, start: new Date(start.getTime() + 30 * 60_000) })
    ).rejects.toMatchObject({ code: "slot_unavailable" });

    await expect(mod.bookings.transitionBooking(alice, booking.id, "approve")).rejects.toMatchObject({
      code: "invalid_transition",
    });
    for (const action of ["approve", "check_in", "start", "finish", "collect"] as const) {
      await mod.bookings.transitionBooking(staff, booking.id, action);
    }
    const events = await mod.client
      .db()
      .select()
      .from(mod.schema.bookingEvents)
      .where(eq(mod.schema.bookingEvents.bookingId, booking.id))
      .orderBy(mod.schema.bookingEvents.id);
    expect(events.map((event) => event.toStatus)).toEqual(["pending", "approved", "checked_in", "printing", "finished", "collected"]);
  });

  it("enforces no double booking in the database itself", async () => {
    const start = nextStart(3);
    const upload = await mod.bookings.storeUpload(alice, "a.gcode", stream(asciiGcode()));
    await mod.bookings.createBooking(alice, { uploadId: upload.id, start });
    const [printer] = await mod.client.db().select().from(mod.schema.printers);
    const overlapping = mod.client.db().insert(mod.schema.bookings).values({
      printerId: printer.id,
      ownerId: bob.userId,
      uploadId: upload.id,
      slot: { start: new Date(start.getTime() + 15 * 60_000), end: new Date(start.getTime() + 45 * 60_000) },
    });
    await expect(overlapping).rejects.toSatisfy((error) => (error as { cause?: { code?: string } }).cause?.code === "23P01");
  });

  it("rejects files sliced for another printer and enforces the active-booking quota", async () => {
    const upload = await mod.bookings.storeUpload(alice, "a.gcode", stream(asciiGcode().replace("printer_model = MK4S", "printer_model = MK3S")));
    await expect(mod.bookings.createBooking(alice, { uploadId: upload.id, start: nextStart(3) })).rejects.toMatchObject({
      code: "wrong_printer",
    });

    await mod.client.db().insert(mod.schema.settings).values({ key: "maxActiveBookingsPerUser", value: 1 });
    const first = await mod.bookings.storeUpload(alice, "1.gcode", stream(asciiGcode()));
    const second = await mod.bookings.storeUpload(alice, "2.gcode", stream(asciiGcode()));
    await mod.bookings.createBooking(alice, { uploadId: first.id, start: nextStart(3) });
    await expect(mod.bookings.createBooking(alice, { uploadId: second.id, start: nextStart(8) })).rejects.toMatchObject({
      code: "quota_exceeded",
    });
  });

  it("expires holds that were never reviewed", async () => {
    const upload = await mod.bookings.storeUpload(alice, "a.gcode", stream(asciiGcode()));
    const booking = await mod.bookings.createBooking(alice, { uploadId: upload.id, start: nextStart(3) });
    const expired = await mod.bookings.expireHolds(mod.client.db(), new Date(Date.now() + 49 * 3_600_000));
    expect(expired).toEqual([booking.id]);
  });
});
