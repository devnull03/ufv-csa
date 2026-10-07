import "server-only";
import z from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);
const flag = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((value) => value === "true" || value === "1");

const schema = z
  .object({
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    SITE_DOMAIN: z.string().min(1),
    // Demo mode: Discord bot calls are replaced by an outbox and an in-browser
    // preview, and the sign-in page offers demo accounts. Discord login still works
    // when its OAuth credentials are set.
    PRINTQ_DEMO: flag,
    // The existing CSA Discord application: its application ID doubles as the OAuth client ID.
    DISCORD_BOT_ID: snowflake.optional(),
    DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
    DISCORD_BOT_TOKEN: z.string().min(1).optional(),
    DISCORD_SERVER_ID: snowflake.optional(),
    PRINTQ_VERIFIED_ROLE_ID: snowflake.optional(),
    PRINTQ_STAFF_ROLE_ID: snowflake.optional(),
    PRINTQ_ADMIN_CHANNEL_ID: snowflake.optional(),
    // Optional members' channel for the anonymous "this week" board.
    PRINTQ_PUBLIC_CHANNEL_ID: snowflake.optional(),
    PRINTQ_ADMIN_DISCORD_IDS: z
      .string()
      .default("")
      .transform((value) => value.split(",").map((id) => id.trim()).filter(Boolean)),
    PRINTQ_CRON_SECRET: z.string().min(32),
    PRINTQ_UPLOAD_DIR: z.string().min(1).default("/var/lib/printq/uploads"),
  })
  .superRefine((env, ctx) => {
    if (env.PRINTQ_DEMO) return;
    // Outside demo mode the real Discord integration is required.
    for (const key of ["DISCORD_BOT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN", "DISCORD_SERVER_ID", "PRINTQ_VERIFIED_ROLE_ID"] as const) {
      if (!env[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required unless PRINTQ_DEMO=true" });
    }
  });

export type PrintQEnv = z.infer<typeof schema>;

let cached: PrintQEnv | undefined;

// Validated lazily so `next build` does not need PrintQ secrets.
export function printqEnv(): PrintQEnv {
  if (!cached) {
    // `KEY=` lines in an env file arrive as empty strings: treat them as unset.
    const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")));
    if (!parsed.success) {
      const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`PrintQ is misconfigured. Check env vars: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test hook: forget the cached env after changing process.env. */
export function resetPrintqEnv() {
  cached = undefined;
}

export function isPrintQEnabled() {
  return process.env.NEXT_PUBLIC_PRINTQ_ENABLED === "true";
}

export const isDemoMode = () => printqEnv().PRINTQ_DEMO;

/** Discord OAuth sign-in is available. */
export function discordLoginConfigured() {
  const env = printqEnv();
  return Boolean(env.DISCORD_BOT_ID && env.DISCORD_CLIENT_SECRET);
}

/** The bot can talk to Discord (membership checks, DMs, channel posts). Off in demo mode. */
export function discordBotConfigured() {
  const env = printqEnv();
  return !env.PRINTQ_DEMO && Boolean(env.DISCORD_BOT_TOKEN && env.DISCORD_SERVER_ID);
}

export function siteOrigin() {
  const domain = process.env.SITE_DOMAIN ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(domain);
  return `http${process.env.NODE_ENV === "development" || local ? "" : "s"}://${domain}`;
}
