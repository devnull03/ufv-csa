import "server-only";
import z from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  SITE_DOMAIN: z.string().min(1),
  // The existing CSA Discord application: its application ID doubles as the OAuth client ID.
  DISCORD_BOT_ID: z.string().regex(/^\d{17,20}$/),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_SERVER_ID: z.string().regex(/^\d{17,20}$/),
  PRINTQ_VERIFIED_ROLE_ID: z.string().regex(/^\d{17,20}$/),
  PRINTQ_STAFF_ROLE_ID: z.string().regex(/^\d{17,20}$/).optional(),
  PRINTQ_ADMIN_CHANNEL_ID: z.string().regex(/^\d{17,20}$/).optional(),
  PRINTQ_ADMIN_DISCORD_IDS: z
    .string()
    .default("")
    .transform((value) => value.split(",").map((id) => id.trim()).filter(Boolean)),
  PRINTQ_CRON_SECRET: z.string().min(32),
  PRINTQ_UPLOAD_DIR: z.string().min(1).default("/var/lib/printq/uploads"),
});

export type PrintQEnv = z.infer<typeof schema>;

let cached: PrintQEnv | undefined;

// Validated lazily so `next build` does not need PrintQ secrets.
export function printqEnv(): PrintQEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`PrintQ is misconfigured. Check env vars: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isPrintQEnabled() {
  return process.env.NEXT_PUBLIC_PRINTQ_ENABLED === "true";
}

export function siteOrigin() {
  const domain = process.env.SITE_DOMAIN ?? "localhost:3000";
  return `http${process.env.NODE_ENV === "development" ? "" : "s"}://${domain}`;
}
