// Database setup shared by the server's startup hook (instrumentation.ts) and
// the npm scripts in scripts/. No Next.js-only imports, so plain Node can run it.
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { DEFAULT_PRINTER_MODEL, printerSpec } from "../printers";
import { addLocalDays, fromLocal, localDateOf, weekdayOf, type LocalDate } from "../scheduling/time";

const TZ = "America/Vancouver";

/** A printer and placeholder lab hours, if there are none yet. Safe to re-run. */
export async function ensureDefaults(sql: Sql, log: (message: string) => void = console.log) {
  const [{ printers }] = await sql`SELECT count(*)::int AS printers FROM printq.printers`;
  if (printers === 0) {
    const spec = printerSpec(process.env.PRINTQ_PRINTER_MODEL || DEFAULT_PRINTER_MODEL);
    if (!spec) throw new Error("Unknown PRINTQ_PRINTER_MODEL (use e.g. MK3S, MK3, MK2.5S)");
    await sql`
      INSERT INTO printq.printers (name, model, bed_x_mm, bed_y_mm, bed_z_mm)
      VALUES (${spec.name}, ${spec.model}, ${spec.bed.x}, ${spec.bed.y}, ${spec.bed.z})`;
    log(`Added printer: ${spec.name}`);
  }
  const [{ hours }] = await sql`SELECT count(*)::int AS hours FROM printq.lab_hours`;
  if (hours === 0) {
    // Placeholder hours (Mon–Fri 10:00–16:00) until admins set real ones in Settings.
    for (const weekday of [1, 2, 3, 4, 5]) {
      await sql`INSERT INTO printq.lab_hours (weekday, opens_at, closes_at) VALUES (${weekday}, '10:00', '16:00')`;
    }
    log("Added default lab hours: Mon–Fri 10:00–16:00");
  }
}

const MEMBERS = [
  { id: "demo-member", name: "Maya K.", username: "maya.k", discordId: "900000000000000001", role: "member" },
  { id: "demo-staff", name: "Sam (staff)", username: "sam.staff", discordId: "900000000000000002", role: "staff" },
  { id: "demo-admin", name: "Alex (admin)", username: "alex.admin", discordId: "900000000000000003", role: "admin" },
  { id: "demo-jordan", name: "Jordan P.", username: "jordan.p", discordId: "900000000000000011", role: "member" },
  { id: "demo-priya", name: "Priya S.", username: "priya.s", discordId: "900000000000000012", role: "member" },
  { id: "demo-chen", name: "Chen W.", username: "chen.w", discordId: "900000000000000013", role: "member" },
  { id: "demo-ola", name: "Ola N.", username: "ola.n", discordId: "900000000000000014", role: "member" },
] as const;

/** The n-th upcoming weekday after `today` (1 = next weekday). */
function weekdayAheadOf(today: LocalDate, n: number): LocalDate {
  let date = today;
  for (let found = 0; found < n; ) {
    date = addLocalDays(date, 1);
    const weekday = weekdayOf(date);
    if (weekday !== 0 && weekday !== 6) found++;
  }
  return date;
}
const at = (date: LocalDate, clock: string) => {
  const [hour, minute] = clock.split(":").map(Number);
  return fromLocal({ ...date, hour, minute }, TZ);
};
const quarter = (date: Date) => new Date(Math.round(date.getTime() / 900_000) * 900_000);

/**
 * Realistic demo data relative to today: the printer, lab hours, closures,
 * demo members and bookings in every state. Without `reset` it does nothing
 * if demo bookings already exist, so it's safe to run on every start.
 */
export async function seedDemoData(sql: Sql, options: { reset?: boolean; log?: (message: string) => void } = {}) {
  const reset = options.reset ?? false;
  const log = options.log ?? console.log;
  const today = localDateOf(new Date(), TZ);
  const weekdayAhead = (n: number) => weekdayAheadOf(today, n);
  if (!reset) {
    // Re-running (e.g. on every container start) must not duplicate the demo bookings.
    const [{ existing }] = await sql`SELECT count(*)::int AS existing FROM printq.bookings WHERE owner_id LIKE 'demo-%'`;
    if (existing > 0) {
      log("Demo data already present; run with --reset to start over.");
      return false;
    }
  }
  await sql.begin(async (tx) => {
    if (reset) {
      await tx`DELETE FROM printq.notifications`;
      await tx`DELETE FROM printq.booking_events`;
      await tx`DELETE FROM printq.bookings`;
      await tx`DELETE FROM printq.uploads WHERE owner_id LIKE 'demo-%'`;
      await tx`DELETE FROM printq.closures`;
      await tx`DELETE FROM printq.lab_hours`;
      await tx`DELETE FROM printq.settings WHERE key = 'labStatus'`;
    }

    // The lab's Original Prusa i3 (PRINTQ_PRINTER_MODEL overrides the variant).
    const spec = printerSpec(process.env.PRINTQ_PRINTER_MODEL || DEFAULT_PRINTER_MODEL)!;
    let [printer] = await tx`SELECT id, model FROM printq.printers WHERE status = 'active' ORDER BY created_at LIMIT 1`;
    if (!printer) {
      [printer] = await tx`
        INSERT INTO printq.printers (name, model, bed_x_mm, bed_y_mm, bed_z_mm)
        VALUES (${spec.name}, ${spec.model}, ${spec.bed.x}, ${spec.bed.y}, ${spec.bed.z}) RETURNING id, model`;
    } else if (reset) {
      [printer] = await tx`
        UPDATE printq.printers SET name = ${spec.name}, model = ${spec.model}, bed_x_mm = ${spec.bed.x}, bed_y_mm = ${spec.bed.y}, bed_z_mm = ${spec.bed.z}
        WHERE id = ${printer.id} RETURNING id, model`;
    }

    const [{ hours }] = await tx`SELECT count(*)::int AS hours FROM printq.lab_hours`;
    if (hours === 0) {
      for (const [weekday, closes] of [[1, "18:00"], [2, "18:00"], [3, "18:00"], [4, "18:00"], [5, "16:00"]] as const) {
        await tx`INSERT INTO printq.lab_hours (weekday, opens_at, closes_at) VALUES (${weekday}, '10:00', ${closes})`;
      }
    }

    for (const member of MEMBERS) {
      await tx`INSERT INTO printq."user" (id, name, email) VALUES (${member.id}, ${member.name}, ${`${member.discordId}@discord.invalid`})
               ON CONFLICT (id) DO NOTHING`;
      await tx`INSERT INTO printq.account (id, account_id, provider_id, user_id, scope)
               VALUES (${`${member.id}-discord`}, ${member.discordId}, 'discord', ${member.id}, 'identify') ON CONFLICT (id) DO NOTHING`;
      await tx`INSERT INTO printq.profiles (user_id, discord_id, discord_username, role, is_guild_member, has_verified_role, eligibility_checked_at)
               VALUES (${member.id}, ${member.discordId}, ${member.username}, ${member.role}, true, true, now())
               ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, discord_username = EXCLUDED.discord_username,
                 is_guild_member = true, has_verified_role = true, eligibility_checked_at = now()`;
    }

    const closures: [string, string, Date, Date][] = [
      ["maintenance", "Nozzle swap", at(weekdayAhead(3), "10:00"), at(weekdayAhead(3), "11:00")],
      ["closure", "CSA general meeting", at(weekdayAhead(4), "12:30"), at(weekdayAhead(4), "16:00")],
      ["closure", "Staff training day", at(weekdayAhead(6), "00:00"), at(addLocalDays(weekdayAhead(6), 1), "00:00")],
    ];
    for (const [kind, reason, start, end] of closures) {
      await tx`INSERT INTO printq.closures (kind, during, reason) VALUES (${kind}, tstzrange(${start.toISOString()}, ${end.toISOString()}, '[)'), ${reason})`;
    }

    const now = new Date();
    const printingStart = quarter(new Date(now.getTime() - 75 * 60_000));
    type Seed = { owner: string; title: string; status: string; start: Date; end: Date; grams: number; reason?: string; purpose: string };
    const bookings: Seed[] = [
      { owner: "demo-jordan", title: "Drone arm mount", status: "printing", start: printingStart, end: new Date(printingStart.getTime() + 4 * 3_600_000), grams: 58, purpose: "club" },
      { owner: "demo-priya", title: "Phone stand", status: "approved", start: at(weekdayAhead(1), "10:00"), end: at(weekdayAhead(1), "12:30"), grams: 31, purpose: "personal" },
      { owner: "demo-chen", title: "Gear set v2", status: "pending", start: at(weekdayAhead(1), "13:00"), end: at(weekdayAhead(1), "15:00"), grams: 24, purpose: "course" },
      { owner: "demo-member", title: "Cable clips ×6", status: "approved", start: at(weekdayAhead(2), "10:30"), end: at(weekdayAhead(2), "12:00"), grams: 12, purpose: "personal" },
      { owner: "demo-ola", title: "Robot chassis", status: "approved", start: at(weekdayAhead(2), "13:00"), end: at(weekdayAhead(2), "16:30"), grams: 96, purpose: "club" },
      { owner: "demo-jordan", title: "Sensor housing", status: "pending", start: at(weekdayAhead(3), "13:00"), end: at(weekdayAhead(3), "16:00"), grams: 44, purpose: "course" },
      { owner: "demo-member", title: "Wall bracket v3", status: "pending", start: at(weekdayAhead(4), "10:00"), end: at(weekdayAhead(4), "12:15"), grams: 46, purpose: "course" },
      { owner: "demo-member", title: "Raspberry Pi 5 case", status: "collected", start: at(addLocalDays(today, -7), "11:00"), end: at(addLocalDays(today, -7), "15:15"), grams: 71, purpose: "personal" },
      { owner: "demo-member", title: "Keycap test", status: "rejected", start: at(addLocalDays(today, -17), "14:00"), end: at(addLocalDays(today, -17), "14:45"), grams: 6, purpose: "personal", reason: "wrong profile" },
      { owner: "demo-priya", title: "Name plate", status: "no_show", start: at(addLocalDays(today, -3), "15:00"), end: at(addLocalDays(today, -3), "16:00"), grams: 9, purpose: "personal" },
    ];

    const decisionFor: Record<string, string[]> = {
      pending: [],
      approved: ["approve"],
      printing: ["approve", "check_in", "start"],
      collected: ["approve", "check_in", "start", "finish", "collect"],
      rejected: ["reject"],
      no_show: ["approve", "no_show"],
    };
    const toStatus: Record<string, string> = {
      approve: "approved", reject: "rejected", check_in: "checked_in", start: "printing", finish: "finished", collect: "collected", no_show: "no_show",
    };

    for (const booking of bookings) {
      const uploadId = randomUUID();
      const minutes = Math.round((booking.end.getTime() - booking.start.getTime()) / 60_000);
      const summary = {
        format: "gcode",
        printSeconds: Math.round(minutes * 60 * 0.85),
        filamentGrams: booking.grams,
        filamentType: "PLA",
        printerModel: booking.title === "Keycap test" ? "MK4S" : printer.model,
        layerHeightMm: 0.2,
        nozzleDiameterMm: 0.4,
        bbox: null,
        hasThumbnail: false,
        analysis: {
          computedSeconds: Math.round(minutes * 60 * 0.88),
          slicerSeconds: Math.round(minutes * 60 * 0.85),
          timeSource: "slicer",
          filamentMm: Math.round((booking.grams / 1.24 / (Math.PI * 0.875 ** 2)) * 1000),
          filamentGrams: booking.grams,
          modelSize: { x: 40 + (booking.grams % 60), y: 30 + (booking.grams % 45), z: 10 + (booking.grams % 50) },
          layers: Math.round((10 + (booking.grams % 50)) / 0.2),
          maxHotendC: booking.title === "Drone arm mount" ? 250 : 215,
          maxBedC: booking.title === "Drone arm mount" ? 90 : 60,
          filamentChanges: booking.title === "Name plate" ? 1 : 0,
          pauses: 0,
          tools: 1,
        },
      };
      await tx`INSERT INTO printq.uploads (id, owner_id, storage_key, original_name, size_bytes, sha256, summary)
               VALUES (${uploadId}, ${booking.owner}, ${`gcode/${uploadId}.gcode`},
                       ${`${booking.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_0.2mm_PLA_${summary.printerModel}.gcode`}, 2400000, 'demo', ${JSON.stringify(summary)}::jsonb)`;
      const holding = booking.status === "pending";
      const [row] = await tx`
        INSERT INTO printq.bookings (printer_id, owner_id, upload_id, slot, status, title, purpose, hold_expires_at, decision_reason, decided_by, decided_at)
        VALUES (${printer.id}, ${booking.owner}, ${uploadId}, tstzrange(${booking.start.toISOString()}, ${booking.end.toISOString()}, '[)'),
                ${booking.status}, ${booking.title}, ${booking.purpose},
                ${holding ? new Date(Date.now() + 40 * 3_600_000).toISOString() : null},
                ${booking.reason ?? null}, ${holding ? null : "demo-staff"}, ${holding ? null : new Date().toISOString()})
        RETURNING id`;
      await tx`INSERT INTO printq.booking_events (booking_id, actor_id, action, to_status, at)
               VALUES (${row.id}, ${booking.owner}, 'request', 'pending', ${new Date(booking.start.getTime() - 2 * 86_400_000).toISOString()})`;
      let from = "pending";
      for (const action of decisionFor[booking.status]) {
        await tx`INSERT INTO printq.booking_events (booking_id, actor_id, action, from_status, to_status, note, at)
                 VALUES (${row.id}, 'demo-staff', ${action}, ${from}, ${toStatus[action]}, ${action === "reject" ? booking.reason ?? null : null},
                         ${new Date(Math.min(Date.now(), booking.start.getTime() + 60_000)).toISOString()})`;
        from = toStatus[action];
      }
    }

    await tx`INSERT INTO printq.settings (key, value) VALUES ('labStatus', ${JSON.stringify({ open: true, since: new Date(Date.now() - 2 * 3_600_000).toISOString() })}::jsonb)
             ON CONFLICT (key) DO NOTHING`;
    log(`Seeded ${MEMBERS.length} demo people, ${bookings.length} bookings and ${closures.length} closures.`);
  });
  return true;
}

