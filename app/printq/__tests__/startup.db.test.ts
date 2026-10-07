import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

// What the server does on start (instrumentation.ts): migrations, default data,
// demo data. It must be safe to run repeatedly and from two servers at once.
const databaseUrl = process.env.PRINTQ_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("server start-up (Postgres)", () => {
  let mod: {
    startup: typeof import("../setup/startup");
    client: typeof import("../db/client");
    env: typeof import("../env");
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "x".repeat(32),
      SITE_DOMAIN: "localhost:3000",
      PRINTQ_DEMO: "true",
      PRINTQ_CRON_SECRET: "y".repeat(32),
      PRINTQ_PRINTER_MODEL: "MK3S",
    });
    mod = {
      startup: await import("../setup/startup"),
      client: await import("../db/client"),
      env: await import("../env"),
    };
    mod.env.resetPrintqEnv();
    await mod.client.db().execute(
      sql`TRUNCATE printq.discord_messages, printq.notifications, printq.booking_events, printq.bookings, printq.uploads, printq.closures,
        printq.lab_hours, printq.settings, printq.printers, printq.profiles, printq.session, printq.account, printq."user" CASCADE`
    );
  });

  const count = async (table: string) =>
    ((await mod.client.db().execute(sql.raw(`SELECT count(*)::int AS n FROM printq.${table}`))) as unknown as { n: number }[])[0].n;

  it("migrates, adds defaults and demo data, and can run twice at once", async () => {
    await Promise.all([mod.startup.setupDatabase(databaseUrl), mod.startup.setupDatabase(databaseUrl)]);
    expect(await count("printers")).toBe(1);
    expect(await count("lab_hours")).toBe(5); // Mon–Fri placeholder hours
    const bookings = await count("bookings");
    expect(bookings).toBeGreaterThan(5);

    // Starting again changes nothing.
    await mod.startup.setupDatabase(databaseUrl);
    expect(await count("printers")).toBe(1);
    expect(await count("bookings")).toBe(bookings);
    const [printer] = (await mod.client.db().execute(sql`SELECT name, model, bed_z_mm FROM printq.printers`)) as unknown as {
      name: string;
      model: string;
      bed_z_mm: number;
    }[];
    expect(printer).toEqual({ name: "Original Prusa i3 MK3S+", model: "MK3S", bed_z_mm: 210 });
  });
});
