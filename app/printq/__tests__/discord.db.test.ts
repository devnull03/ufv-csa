import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { InteractionResponseType, InteractionType } from "discord-api-types/v10";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Discord login and bot interactions against a real Postgres. Only Discord's
// HTTP API is mocked; Better Auth, the database and our code run for real.
const databaseUrl = process.env.PRINTQ_TEST_DATABASE_URL;

const GUILD = "287455376994205716";
const VERIFIED_ROLE = "100000000000000003";
const DISCORD_USER = { id: "123456789012345678", username: "maya.k", global_name: "Maya K.", avatar: null, discriminator: "0" };

describe.skipIf(!databaseUrl)("Discord login and interactions (Postgres)", () => {
  let uploadDir: string;
  let memberRoles: string[] | null = [VERIFIED_ROLE];
  const tokenRequests: URLSearchParams[] = [];
  const realFetch = globalThis.fetch;
  let mod: {
    auth: typeof import("../auth");
    env: typeof import("../env");
    profiles: typeof import("../profiles");
    client: typeof import("../db/client");
    schema: typeof import("../db/schema");
    handlers: typeof import("../discord/handlers");
  };

  beforeAll(async () => {
    uploadDir = await mkdtemp(path.join(tmpdir(), "printq-discord-"));
    Object.assign(process.env, {
      NEXT_PUBLIC_PRINTQ_ENABLED: "true",
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "x".repeat(32),
      SITE_DOMAIN: "localhost:3000",
      PRINTQ_DEMO: "false",
      DISCORD_BOT_ID: "100000000000000001",
      DISCORD_CLIENT_SECRET: "client-secret",
      DISCORD_BOT_TOKEN: "bot-token",
      DISCORD_SERVER_ID: GUILD,
      PRINTQ_VERIFIED_ROLE_ID: VERIFIED_ROLE,
      PRINTQ_CRON_SECRET: "y".repeat(32),
      PRINTQ_UPLOAD_DIR: uploadDir,
    });
    mod = {
      auth: await import("../auth"),
      env: await import("../env"),
      profiles: await import("../profiles"),
      client: await import("../db/client"),
      schema: await import("../db/schema"),
      handlers: await import("../discord/handlers"),
    };
    mod.env.resetPrintqEnv();
    mod.auth.resetAuth();

    // Fake Discord: OAuth token exchange, /users/@me and guild member lookups.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://discord.com/api/oauth2/token") {
        tokenRequests.push(new URLSearchParams(String(init?.body ?? "")));
        return Response.json({ access_token: "access", token_type: "Bearer", expires_in: 604800, refresh_token: "refresh", scope: "identify" });
      }
      if (/^https:\/\/discord\.com\/api\/users\/(@|%40)me$/.test(url)) return Response.json(DISCORD_USER);
      if (url.startsWith(`https://discord.com/api/v10/guilds/${GUILD}/members/`)) {
        return memberRoles ? Response.json({ roles: memberRoles, user: { username: DISCORD_USER.username } }) : new Response("{}", { status: 404 });
      }
      if (url.startsWith("https://discord.com/")) return Response.json({ id: String(Date.now()) });
      return realFetch(input, init);
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await rm(uploadDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    memberRoles = [VERIFIED_ROLE];
    tokenRequests.length = 0;
    await mod.client.db().execute(
      sql`TRUNCATE printq.discord_messages, printq.notifications, printq.booking_events, printq.bookings, printq.uploads, printq.closures,
        printq.lab_hours, printq.settings, printq.printers, printq.profiles, printq.session, printq.account,
        printq.verification, printq."user" CASCADE`
    );
  });

  const cookiesFrom = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");

  async function signInWithDiscord() {
    const handler = mod.auth.auth().handler;
    const start = await handler(
      new Request("http://localhost:3000/api/printq/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ provider: "discord", callbackURL: "/printing/new" }),
      })
    );
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const authorize = new URL(url);
    const callback = await handler(
      new Request(`http://localhost:3000/api/printq/auth/callback/discord?code=the-code&state=${authorize.searchParams.get("state")}`, {
        headers: { Cookie: cookiesFrom(start) },
      })
    );
    return { authorize, callback };
  }

  it("signs in through Discord OAuth with only the identify scope and creates a session", async () => {
    const { authorize, callback } = await signInWithDiscord();
    expect(authorize.origin + authorize.pathname).toBe("https://discord.com/api/oauth2/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("100000000000000001");
    expect(authorize.searchParams.get("scope")).toBe("identify");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/printq/auth/callback/discord");

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/printing/new");
    expect(tokenRequests[0].get("code")).toBe("the-code");
    expect(tokenRequests[0].get("client_secret") ?? "basic-auth").toBeTruthy();

    const session = await mod.auth.auth().api.getSession({ headers: new Headers({ Cookie: cookiesFrom(callback) }) });
    expect(session?.user.name).toBe("Maya K.");
    expect(session?.user.email).toBe(`${DISCORD_USER.id}@discord.invalid`);

    const viewer = await mod.profiles.viewerForUser(session!.user);
    expect(viewer).toMatchObject({ discordId: DISCORD_USER.id, discordUsername: "maya.k", role: "member", ineligibleReason: null });
  });

  it("flags members without the verified role, and people outside the server", async () => {
    memberRoles = [];
    const first = await signInWithDiscord();
    const session = await mod.auth.auth().api.getSession({ headers: new Headers({ Cookie: cookiesFrom(first.callback) }) });
    expect((await mod.profiles.viewerForUser(session!.user))?.ineligibleReason).toBe("missing_role");

    memberRoles = null; // 404 from Discord
    await mod.client.db().update(mod.schema.profiles).set({ eligibilityCheckedAt: null });
    expect((await mod.profiles.viewerForUser(session!.user))?.ineligibleReason).toBe("not_in_server");
  });

  it("rejects a callback with a forged state", async () => {
    const response = await mod.auth.auth().handler(
      new Request("http://localhost:3000/api/printq/auth/callback/discord?code=x&state=forged")
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error");
    expect(tokenRequests).toHaveLength(0);
  });

  it("answers /print schedule and lets staff approve from the admin channel", async () => {
    const database = mod.client.db();
    const { schema } = mod;
    const [printer] = await database.insert(schema.printers).values({ name: "Prusa MK4S", model: "MK4S", bedX: 250, bedY: 210, bedZ: 220 }).returning();
    await database.insert(schema.labHours).values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" })));
    for (const [id, discordId, role] of [["staff-user", "222222222222222222", "staff"], ["member-user", "333333333333333333", "member"]] as const) {
      await database.insert(schema.user).values({ id, name: id, email: `${discordId}@discord.invalid` });
      await database.insert(schema.account).values({ id: `${id}-a`, accountId: discordId, providerId: "discord", userId: id });
      await database.insert(schema.profiles).values({ userId: id, discordId, role, isGuildMember: true, hasVerifiedRole: true, eligibilityCheckedAt: new Date() });
    }
    const [upload] = await database
      .insert(schema.uploads)
      .values({
        ownerId: "member-user",
        storageKey: "gcode/00000000-0000-4000-8000-0000000000aa.bgcode",
        originalName: "clip.bgcode",
        sizeBytes: 1,
        sha256: "x",
        summary: { format: "bgcode", printSeconds: 3600, filamentGrams: 10, filamentType: "PLA", printerModel: "MK4S", bbox: null, hasThumbnail: false },
      })
      .returning();
    const start = new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 900_000) * 900_000);
    const [booking] = await database
      .insert(schema.bookings)
      .values({ printerId: printer.id, ownerId: "member-user", uploadId: upload.id, title: "Clip", slot: { start, end: new Date(start.getTime() + 3_600_000) } })
      .returning();

    const call = async (interaction: object) => (await mod.handlers.handlePrintQInteraction(interaction as never)).json();

    const schedule = await call({
      type: InteractionType.ApplicationCommand,
      data: { type: 1, name: "print", options: [{ type: 1, name: "schedule", options: [] }] },
      member: { user: { id: "333333333333333333" } },
    });
    expect(schedule.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(schedule.data.embeds[0].title).toBe("Prusa MK4S · schedule");
    expect(JSON.stringify(schedule.data.embeds[0].fields)).toContain("Pending");
    expect(JSON.stringify(schedule)).not.toContain("member-user");

    const mine = await call({
      type: InteractionType.ApplicationCommand,
      data: { type: 1, name: "print", options: [{ type: 1, name: "mine" }] },
      member: { user: { id: "333333333333333333" } },
    });
    expect(mine.data.embeds[0].description).toContain("Clip");

    const button = (userId: string) => ({
      type: InteractionType.MessageComponent,
      data: { custom_id: `printq:approve:${booking.id}`, component_type: 2 },
      member: { user: { id: userId } },
      message: { embeds: [{ title: "New print request · Clip" }] },
    });
    const denied = await call(button("333333333333333333"));
    expect(denied.data.content).toContain("Only PrintQ staff");

    const approved = await call(button("222222222222222222"));
    expect(approved.type).toBe(InteractionResponseType.UpdateMessage);
    expect(approved.data.embeds[0].title).toContain("Approved");
    expect(approved.data.embeds[0].description).toContain("Approved by <@222222222222222222>");
    expect(JSON.stringify(approved.data.components)).toContain(`printq:check_in:${booking.id}`);

    const reject = await call({
      type: InteractionType.MessageComponent,
      data: { custom_id: `printq:reject:${booking.id}`, component_type: 2 },
      member: { user: { id: "222222222222222222" } },
    });
    expect(reject.type).toBe(InteractionResponseType.Modal);
    expect(reject.data.custom_id).toBe(`printq:m_reject:${booking.id}`);

    const [row] = await database.select().from(schema.bookings);
    expect(row.status).toBe("approved");
  });
});
