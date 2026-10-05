import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The bot's REST traffic when it's live (not demo): what it posts, edits,
// threads and pins in the staff channel. Only Discord's API is faked.
const databaseUrl = process.env.PRINTQ_TEST_DATABASE_URL;

const ADMIN_CHANNEL = "700000000000000001";
const PUBLIC_CHANNEL = "700000000000000002";
const MEMBER = "333333333333333333";

describe.skipIf(!databaseUrl)("Discord staff channel (Postgres, live REST)", () => {
  const calls: { method: string; path: string; body: any }[] = [];
  let nextId = 800_000_000_000_000; // stays within safe integers
  let deleted = new Set<string>();
  let mod: {
    notify: typeof import("../notify");
    bookings: typeof import("../bookings");
    sync: typeof import("../discord/sync");
    env: typeof import("../env");
    client: typeof import("../db/client");
    schema: typeof import("../db/schema");
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      NEXT_PUBLIC_PRINTQ_ENABLED: "true",
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "x".repeat(32),
      SITE_DOMAIN: "csa.ufv.ca",
      PRINTQ_DEMO: "false",
      DISCORD_BOT_ID: "100000000000000001",
      DISCORD_CLIENT_SECRET: "client-secret",
      DISCORD_BOT_TOKEN: "bot-token",
      DISCORD_SERVER_ID: "287455376994205716",
      PRINTQ_VERIFIED_ROLE_ID: "100000000000000003",
      PRINTQ_ADMIN_CHANNEL_ID: ADMIN_CHANNEL,
      PRINTQ_PUBLIC_CHANNEL_ID: PUBLIC_CHANNEL,
      PRINTQ_CRON_SECRET: "y".repeat(32),
      PRINTQ_UPLOAD_DIR: "/tmp/printq-live-test",
    });
    mod = {
      notify: await import("../notify"),
      bookings: await import("../bookings"),
      sync: await import("../discord/sync"),
      env: await import("../env"),
      client: await import("../db/client"),
      schema: await import("../db/schema"),
    };
    mod.env.resetPrintqEnv();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace("https://discord.com/api/v10", "");
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (method === "PATCH" && [...deleted].some((id) => path.endsWith(`/messages/${id}`))) return new Response('{"message":"Unknown Message"}', { status: 404 });
      if (method === "PUT") return new Response(null, { status: 204 });
      return Response.json({ id: String(nextId++) });
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    mod.env.resetPrintqEnv();
  });

  beforeEach(async () => {
    calls.length = 0;
    deleted = new Set();
    await mod.client.db().execute(
      sql`TRUNCATE printq.discord_messages, printq.notifications, printq.booking_events, printq.bookings, printq.uploads, printq.closures,
        printq.lab_hours, printq.settings, printq.printers, printq.profiles, printq.session, printq.account, printq."user" CASCADE`
    );
  });

  async function seed() {
    const database = mod.client.db();
    const { schema } = mod;
    const [printer] = await database.insert(schema.printers).values({ name: "Prusa MK4S", model: "MK4S", bedX: 250, bedY: 210, bedZ: 220 }).returning();
    await database.insert(schema.user).values([
      { id: "member-user", name: "Maya", email: "m@discord.invalid" },
      { id: "staff-user", name: "Sam", email: "s@discord.invalid" },
    ]);
    await database.insert(schema.profiles).values([
      { userId: "member-user", discordId: MEMBER, discordUsername: "maya.k", isGuildMember: true, hasVerifiedRole: true, eligibilityCheckedAt: new Date() },
      { userId: "staff-user", discordId: "222222222222222222", discordUsername: "sam", role: "staff", isGuildMember: true, hasVerifiedRole: true, eligibilityCheckedAt: new Date() },
    ]);
    const [upload] = await database
      .insert(schema.uploads)
      .values({
        ownerId: "member-user",
        storageKey: "gcode/00000000-0000-4000-8000-0000000000cc.bgcode",
        originalName: "clip.bgcode",
        sizeBytes: 1,
        sha256: "x",
        summary: { format: "bgcode", printSeconds: 3600, filamentGrams: 10, filamentType: "PLA", printerModel: "MK4S", bbox: null, hasThumbnail: false },
      })
      .returning();
    const start = new Date(Math.ceil((Date.now() + 5 * 3_600_000) / 900_000) * 900_000);
    const [booking] = await database
      .insert(schema.bookings)
      .values({ printerId: printer.id, ownerId: "member-user", uploadId: upload.id, title: "Clip", slot: { start, end: new Date(start.getTime() + 3_600_000) } })
      .returning();
    return booking;
  }

  const posts = (path: RegExp) => calls.filter((call) => call.method === "POST" && path.test(call.path));

  it("posts the card with a thread, pins the boards, then edits in place", async () => {
    const booking = await seed();
    await mod.notify.onBookingRequested(booking);

    const card = posts(new RegExp(`^/channels/${ADMIN_CHANNEL}/messages$`))[0];
    expect(card.body.embeds[0].title).toBe("⏳ Pending review · Clip");
    expect(card.body.embeds[0].description).toContain(`<@${MEMBER}>`);
    expect(card.body.allowed_mentions).toEqual({ parse: [] });
    const thread = posts(/\/threads$/)[0];
    expect(thread.body.name).toBe("Clip · maya.k");
    const [row] = await mod.client.db().select().from(mod.schema.discordMessages).where(sql`kind = 'card'`);
    expect(posts(new RegExp(`^/channels/${row.threadId}/messages$`))[0].body.content).toBe(`📥 Requested by <@${MEMBER}>`);
    expect(calls.filter((call) => call.method === "PUT" && call.path.includes("/pins/"))).toHaveLength(2); // staff + public board
    expect(posts(/^\/users\/@me\/channels$/)[0].body).toEqual({ recipient_id: MEMBER });

    calls.length = 0;
    const staff = { userId: "staff-user", name: "Sam", image: null, discordId: "222222222222222222", discordUsername: "sam", role: "staff" as const, ineligibleReason: null, bannedUntil: null };
    const approved = await mod.bookings.transitionBooking(staff, booking.id, "approve");
    await mod.notify.onBookingTransition(approved, "approve", "staff-user");
    const edit = calls.find((call) => call.method === "PATCH" && call.path === `/channels/${ADMIN_CHANNEL}/messages/${row.messageId}`);
    expect(edit?.body.embeds[0].title).toBe("✅ Approved · Clip");
    expect(posts(new RegExp(`^/channels/${ADMIN_CHANNEL}/messages$`))).toHaveLength(0); // no new card, no new board
    expect(posts(new RegExp(`^/channels/${row.threadId}/messages$`))[0].body.content).toBe("✅ Approved by <@222222222222222222>");
  });

  it("re-posts a card that someone deleted", async () => {
    const booking = await seed();
    await mod.sync.syncBooking(booking.id);
    const [before] = await mod.client.db().select().from(mod.schema.discordMessages).where(sql`kind = 'card'`);
    deleted.add(before.messageId);
    calls.length = 0;
    await mod.sync.syncBooking(booking.id);
    const [after] = await mod.client.db().select().from(mod.schema.discordMessages).where(sql`kind = 'card'`);
    expect(after.messageId).not.toBe(before.messageId);
    expect(posts(new RegExp(`^/channels/${ADMIN_CHANNEL}/messages$`))).toHaveLength(1);
  });
});
