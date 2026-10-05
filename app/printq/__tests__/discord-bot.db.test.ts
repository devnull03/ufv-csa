import { InteractionResponseType, InteractionType } from "discord-api-types/v10";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// The staff-channel bot, end to end through the real interaction handler and
// Postgres, in demo mode (messages are stored instead of sent).
const databaseUrl = process.env.PRINTQ_TEST_DATABASE_URL;

const STAFF = "222222222222222222";
const ADMIN = "444444444444444444";
const MEMBER = "333333333333333333";
const STRANGER = "555555555555555555";
const STAFF_ROLE = "100000000000000009";

describe.skipIf(!databaseUrl)("Discord staff channel (Postgres, demo mode)", () => {
  let mod: {
    handlers: typeof import("../discord/handlers");
    sync: typeof import("../discord/sync");
    notify: typeof import("../notify");
    bookings: typeof import("../bookings");
    lab: typeof import("../lab-status");
    env: typeof import("../env");
    client: typeof import("../db/client");
    schema: typeof import("../db/schema");
    profiles: typeof import("../profiles");
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      NEXT_PUBLIC_PRINTQ_ENABLED: "true",
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "x".repeat(32),
      SITE_DOMAIN: "localhost:3000",
      PRINTQ_DEMO: "true",
      PRINTQ_STAFF_ROLE_ID: STAFF_ROLE,
      PRINTQ_ADMIN_DISCORD_IDS: ADMIN,
      PRINTQ_CRON_SECRET: "y".repeat(32),
      PRINTQ_UPLOAD_DIR: "/tmp/printq-bot-test",
    });
    mod = {
      handlers: await import("../discord/handlers"),
      sync: await import("../discord/sync"),
      notify: await import("../notify"),
      bookings: await import("../bookings"),
      lab: await import("../lab-status"),
      env: await import("../env"),
      client: await import("../db/client"),
      schema: await import("../db/schema"),
      profiles: await import("../profiles"),
    };
    mod.env.resetPrintqEnv();
  });

  let printerId: string;

  beforeEach(async () => {
    const database = mod.client.db();
    await database.execute(
      sql`TRUNCATE printq.discord_messages, printq.notifications, printq.booking_events, printq.bookings, printq.uploads, printq.closures,
        printq.lab_hours, printq.settings, printq.printers, printq.profiles, printq.session, printq.account, printq."user" CASCADE`
    );
    const { schema } = mod;
    const [printer] = await database.insert(schema.printers).values({ name: "Prusa MK4S", model: "MK4S", bedX: 250, bedY: 210, bedZ: 220 }).returning();
    printerId = printer.id;
    await database.insert(schema.labHours).values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" })));
    for (const [id, discordId, role, username] of [
      ["staff-user", STAFF, "staff", "sam.staff"],
      ["admin-user", ADMIN, "admin", "alex.admin"],
      ["member-user", MEMBER, "member", "maya.k"],
    ] as const) {
      await database.insert(schema.user).values({ id, name: username, email: `${discordId}@discord.invalid` });
      await database.insert(schema.account).values({ id: `${id}-a`, accountId: discordId, providerId: "discord", userId: id });
      await database
        .insert(schema.profiles)
        .values({ userId: id, discordId, discordUsername: username, role, isGuildMember: true, hasVerifiedRole: true, eligibilityCheckedAt: new Date() });
    }
  });

  const hour = 3_600_000;
  const startIn = (hours: number) => new Date(Math.ceil((Date.now() + hours * hour) / 900_000) * 900_000);

  async function booking(title: string, start: Date, status: "pending" | "approved" = "pending", hours = 1) {
    const database = mod.client.db();
    const [upload] = await database
      .insert(mod.schema.uploads)
      .values({
        ownerId: "member-user",
        storageKey: `gcode/${crypto.randomUUID()}.bgcode`,
        originalName: `${title}.bgcode`,
        sizeBytes: 1,
        sha256: "x",
        summary: { format: "bgcode", printSeconds: 3000, filamentGrams: 12, filamentType: "PLA", printerModel: "MK4S", bbox: null, hasThumbnail: false },
      })
      .returning();
    const [row] = await database
      .insert(mod.schema.bookings)
      .values({ printerId, ownerId: "member-user", uploadId: upload.id, title, status, slot: { start, end: new Date(start.getTime() + hours * hour) }, holdExpiresAt: new Date(Date.now() + 40 * hour) })
      .returning();
    return row;
  }

  const as = (discordId: string, roles: string[] = []) => ({ member: { user: { id: discordId, username: `user${discordId.slice(-3)}` }, roles }, token: "t", id: "1" });
  const call = async (interaction: object) => (await mod.handlers.respond(interaction as never)) as { type: number; data: any };
  const click = (discordId: string, customId: string, extra: object = {}) =>
    call({ type: InteractionType.MessageComponent, data: { custom_id: customId, component_type: 2 }, message: { embeds: [] }, ...as(discordId), ...extra });
  const select = (discordId: string, customId: string, values: string[]) =>
    call({ type: InteractionType.MessageComponent, data: { custom_id: customId, component_type: 3, values }, message: { embeds: [] }, ...as(discordId) });
  const submit = (discordId: string, customId: string, fields: Record<string, string>) =>
    call({
      type: InteractionType.ModalSubmit,
      data: { custom_id: customId, components: Object.entries(fields).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) },
      ...as(discordId),
    });
  const command = (discordId: string, name: string, sub: string, options: { name: string; type: number; value: unknown; focused?: boolean }[] = [], type = InteractionType.ApplicationCommand) =>
    call({ type, data: { type: 1, name, options: [{ type: 1, name: sub, options }] }, ...as(discordId, discordId === STAFF ? [STAFF_ROLE] : []) });

  const stored = async (kind: "card" | "board" | "public_board", bookingId?: string) => {
    const rows = await mod.client.db().select().from(mod.schema.discordMessages).where(eq(mod.schema.discordMessages.kind, kind));
    return rows.find((row) => !bookingId || row.bookingId === bookingId)!;
  };
  const ids = (payload: { components: unknown[] }) => JSON.stringify(payload.components).match(/printq:[a-z_]+:[\w-]+/g) ?? [];
  const logs = async (bookingId: string) =>
    (await mod.sync.cardLogs([bookingId])).map((row) => row.line);
  const status = async (bookingId: string) =>
    (await mod.client.db().select().from(mod.schema.bookings).where(eq(mod.schema.bookings.id, bookingId)))[0].status;

  it("posts a card for a new request and keeps it current through the whole print", async () => {
    const request = await booking("Gear set", startIn(3));
    await mod.notify.onBookingRequested(request);
    let card = await stored("card", request.id);
    expect((card.payload.embeds[0] as { title: string }).title).toBe("⏳ Pending review · Gear set");
    expect(ids(card.payload)).toEqual([`printq:approve:${request.id}`, `printq:reject:${request.id}`, `printq:move:${request.id}`]);
    expect(await stored("board")).toBeTruthy();
    expect(await stored("public_board")).toBeTruthy();

    const approved = await click(STAFF, `printq:approve:${request.id}`);
    expect(approved.type).toBe(InteractionResponseType.UpdateMessage);
    expect(approved.data.embeds[0].title).toBe("✅ Approved · Gear set");
    expect(approved.data.embeds[0].description).toContain("Approved by @sam.staff");
    expect(ids(approved.data)).toEqual([`printq:check_in:${request.id}`, `printq:no_show:${request.id}`, `printq:cancel:${request.id}`, `printq:move:${request.id}`]);

    // A change made on the website edits the same card.
    const staff = (await mod.profiles.viewerForDiscordId(STAFF))!;
    const checkedIn = await mod.bookings.transitionBooking(staff, request.id, "check_in");
    await mod.notify.onBookingTransition(checkedIn, "check_in", staff.userId);
    card = await stored("card", request.id);
    expect((card.payload.embeds[0] as { title: string }).title).toBe("📍 Checked in · Gear set");

    await click(STAFF, `printq:start:${request.id}`);
    expect(((await stored("board")).payload.embeds[0] as { fields: { name: string; value: string }[] }).fields[0].value).toContain("Gear set");
    await click(STAFF, `printq:finish:${request.id}`);
    const collected = await click(STAFF, `printq:collect:${request.id}`);
    expect(collected.data.embeds[0].title).toBe("📦 Completed · Gear set");
    expect(ids(collected.data)).toEqual([]);

    expect(await logs(request.id)).toEqual([
      "📥 Requested by @maya.k",
      "✅ Approved by @sam.staff",
      "📍 Checked in by @sam.staff",
      "🖨️ Print started by @sam.staff",
      "🏁 Finished · @sam.staff",
      "📦 Collected · @sam.staff",
    ]);
    const dms = await mod.client.db().select().from(mod.schema.notifications).where(eq(mod.schema.notifications.recipientUserId, "member-user"));
    expect(dms.map((row) => row.kind)).toEqual(["request_received", "booking_approve", "booking_finish"]);
    expect(JSON.stringify(dms[1].components)).toContain(`printq:mcancel:${request.id}`);
  });

  it("asks for a reason before rejecting or failing, and tells the member", async () => {
    const request = await booking("Keycap", startIn(3));
    const modal = await click(STAFF, `printq:reject:${request.id}`);
    expect(modal.type).toBe(InteractionResponseType.Modal);
    const rejected = await submit(STAFF, modal.data.custom_id, { reason: "Wrong printer profile" });
    expect(rejected.data.embeds[0].description).toContain("Declined by @sam.staff: Wrong printer profile");
    const [dm] = await mod.client.db().select().from(mod.schema.notifications).where(eq(mod.schema.notifications.kind, "booking_reject"));
    expect(dm.body).toContain("Wrong printer profile");
  });

  it("refuses non-staff, recognises the staff role, and reports double clicks", async () => {
    const request = await booking("Clip", startIn(3));
    expect((await click(MEMBER, `printq:approve:${request.id}`)).data.content).toContain("Only PrintQ staff");
    expect((await click(STRANGER, `printq:approve:${request.id}`)).data.content).toContain("Only PrintQ staff");

    // Someone with the Discord staff role who never signed in to the website.
    const approved = await call({
      type: InteractionType.MessageComponent,
      data: { custom_id: `printq:approve:${request.id}`, component_type: 2 },
      message: { embeds: [] },
      member: { user: { id: STRANGER, username: "new.staff" }, roles: [STAFF_ROLE], nick: "New Staff" },
    });
    expect(approved.type).toBe(InteractionResponseType.UpdateMessage);
    const [profile] = await mod.client.db().select().from(mod.schema.profiles).where(eq(mod.schema.profiles.discordId, STRANGER));
    expect(profile.role).toBe("staff");

    const again = await click(STAFF, `printq:approve:${request.id}`);
    expect(again.data.content).toBe("This booking is already **approved** by New Staff.");
  });

  it("moves a booking, names a clash, and lets the member keep or cancel", async () => {
    const first = await booking("Bracket", startIn(26), "approved");
    const second = await booking("Stand", startIn(30), "approved");
    const clash = await submit(STAFF, `printq:m_move:${second.id}`, { when: `${first.slot.start.toISOString().slice(0, 10)} ${"x"}` }).catch(() => null);
    expect(clash?.data.content).toBeTruthy(); // unreadable time → explained

    const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Vancouver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const phrase = (date: Date) => local.format(date).replace(",", "").replace(/ /g, " ");
    const overlapping = await submit(STAFF, `printq:m_move:${second.id}`, { when: phrase(new Date(first.slot.start.getTime() + 30 * 60_000)) });
    expect(overlapping.data.content).toContain("That overlaps Bracket");

    const target = new Date(second.slot.start.getTime() + 2 * hour);
    const moved = await submit(STAFF, `printq:m_move:${second.id}`, { when: phrase(target) });
    expect(moved.type).toBe(InteractionResponseType.UpdateMessage);
    const [row] = await mod.client.db().select().from(mod.schema.bookings).where(eq(mod.schema.bookings.id, second.id));
    expect(row.slot.start.getTime()).toBe(target.getTime());
    expect(row.slot.end.getTime() - row.slot.start.getTime()).toBe(hour);

    const [dm] = await mod.client.db().select().from(mod.schema.notifications).where(eq(mod.schema.notifications.kind, "booking_moved"));
    expect(JSON.stringify(dm.components)).toContain(`printq:mkeep:${second.id}`);
    const dmClick = (customId: string) =>
      call({ type: InteractionType.MessageComponent, data: { custom_id: customId, component_type: 2 }, message: { embeds: [{ title: dm.title }] }, user: { id: MEMBER, username: "maya.k" } });
    expect((await dmClick(`printq:mkeep:${second.id}`)).data.content).toContain("see you then");
    expect((await dmClick(`printq:mcancel:${first.id}`)).data.content).toContain("Cancelled **Bracket**");
    expect(await status(first.id)).toBe("cancelled");
    expect((await call({ type: InteractionType.MessageComponent, data: { custom_id: `printq:mkeep:${first.id}`, component_type: 2 }, message: { embeds: [] }, user: { id: STAFF } })).data.content).toContain(
      "isn't one of your bookings"
    );
    expect(await logs(second.id)).toEqual(expect.arrayContaining([expect.stringContaining("🕒 Moved by @sam.staff"), "👍 Member is keeping the new time"]));
  });

  it("adds a closure only after confirming who it affects", async () => {
    const tomorrow = startIn(24);
    const approved = await booking("Robot chassis", tomorrow, "approved");
    const pending = await booking("Name plate", new Date(tomorrow.getTime() + 2 * hour));
    const later = await booking("Unaffected", new Date(tomorrow.getTime() + 50 * hour));
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(tomorrow);

    const form = await click(STAFF, "printq:addclosure:board");
    expect(form.type).toBe(InteractionResponseType.Modal);
    const confirm = await submit(STAFF, "printq:m_closure:new", { when: `${day} all day`, reason: "Staff training", kind: "" });
    expect(confirm.data.flags).toBe(64);
    expect(confirm.data.embeds[0].description).toContain("This affects **2** bookings");
    const ok = ids(confirm.data).find((id) => id.startsWith("printq:closeok:"))!;

    expect(await mod.client.db().select().from(mod.schema.closures)).toHaveLength(0);
    const done = await click(STAFF, ok);
    expect(done.data.content).toContain("2 bookings closed; members were messaged");
    expect(await status(approved.id)).toBe("lab_closed");
    expect(await status(pending.id)).toBe("rejected");
    expect(await status(later.id)).toBe("pending");
    expect((await click(STAFF, ok)).data.content).toContain("already used");

    const board = await stored("board");
    expect(JSON.stringify(board.payload)).toContain("Staff training");
    const [closure] = await mod.client.db().select().from(mod.schema.closures);
    const afterRemove = await select(STAFF, "printq:rmclosure:board", [closure.id]);
    expect(afterRemove.type).toBe(InteractionResponseType.UpdateMessage);
    expect(JSON.stringify(afterRemove.data)).not.toContain("Staff training");
    expect(await mod.client.db().select().from(mod.schema.closures)).toHaveLength(0);
  });

  it("lets admins (only) change lab hours from the board", async () => {
    expect((await click(STAFF, "printq:hoursday:1")).data.content).toContain("Only PrintQ admins");
    const form = await click(ADMIN, "printq:hoursday:1");
    expect(form.type).toBe(InteractionResponseType.Modal);
    expect(JSON.stringify(form.data)).toContain("00:00-24:00");
    const saved = await submit(ADMIN, "printq:m_hours:1", { hours: "10am-12, 1-5pm" });
    expect(saved.data.content).toBe("**Monday** is now 10:00 AM–12:00 PM, 1:00 PM–5:00 PM.");
    const monday = (await mod.client.db().select().from(mod.schema.labHours).where(eq(mod.schema.labHours.weekday, 1))).map((row) => `${row.opensAt}-${row.closesAt}`);
    expect(monday.sort()).toEqual(["10:00:00-12:00:00", "13:00:00-17:00:00"]);
    expect((await submit(ADMIN, "printq:m_hours:1", { hours: "late" })).data.content).toContain("couldn't read");
  });

  it("opens and closes the lab from the board", async () => {
    await mod.sync.syncBoards();
    const closed = await click(STAFF, "printq:lab:close");
    expect(closed.type).toBe(InteractionResponseType.UpdateMessage);
    expect(closed.data.embeds[0].description).toContain("Lab closed");
    expect(ids(closed.data)).toContain("printq:lab:open");
    expect((await mod.lab.getLabStatus()).open).toBe(false);
    expect((await click(MEMBER, "printq:lab:open")).data.content).toContain("Only PrintQ staff");
  });

  it("answers the /printstaff commands", async () => {
    const request = await booking("Sensor housing", startIn(5));
    await booking("Phone stand", startIn(8), "approved");
    const pending = await command(STAFF, "printstaff", "pending");
    expect(pending.data.embeds[0].title).toBe("📥 1 request waiting");
    const opened = await select(STAFF, "printq:show:pending", [request.id]);
    expect(opened.data.flags).toBe(64);
    expect(opened.data.embeds[0].title).toBe("⏳ Pending review · Sensor housing");

    const search = await command(STAFF, "printstaff", "booking", [{ name: "search", type: 3, value: "phone", focused: true }], InteractionType.ApplicationCommandAutocomplete);
    expect(search.data.choices[0].name).toContain("Phone stand");
    const found = await command(STAFF, "printstaff", "booking", [{ name: "search", type: 3, value: "@maya" }]);
    expect(found.data.embeds[0].description).toContain("@maya.k");

    const hint = await command(STAFF, "printstaff", "close", [{ name: "when", type: 3, value: "Fri 12:30-4pm", focused: true }], InteractionType.ApplicationCommandAutocomplete);
    expect(hint.data.choices[0].name).toMatch(/^✓ Fri/);
    const draft = await command(STAFF, "printstaff", "close", [
      { name: "when", type: 3, value: "Fri 12:30-4pm" },
      { name: "reason", type: 3, value: "CSA meeting" },
      { name: "maintenance", type: 5, value: true },
    ]);
    expect(draft.data.embeds[0].title).toBe("Add this maintenance?");

    expect((await command(MEMBER, "printstaff", "pending")).data.content).toContain("Only PrintQ staff");
    expect((await command(STAFF, "printstaff", "hours", [{ name: "day", type: 4, value: 6 }, { name: "hours", type: 3, value: "closed" }])).data.content).toContain(
      "Only PrintQ admins"
    );

    const before = (await stored("board"))?.messageId;
    expect((await command(STAFF, "printstaff", "board")).data.content).toBe("Board posted and pinned.");
    expect((await stored("board")).messageId).not.toBe(before);
  });
});
