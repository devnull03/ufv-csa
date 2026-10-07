/**
 * LOCAL DEVELOPMENT ONLY. Creates a fake Discord-linked user and session so the
 * PrintQ pages can be used without real Discord OAuth.
 *   npx tsx --env-file=.env.local scripts/printq-dev-login.ts [member|staff|admin]
 * Then set the printed cookie on http://localhost:3000 in the browser devtools.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

const role = (process.argv[2] ?? "admin") as "member" | "staff" | "admin";
const databaseUrl = process.env.DATABASE_URL ?? "postgres://printq:printq@localhost:5432/printq";
const secret = process.env.BETTER_AUTH_SECRET ?? "";

// Local databases only, or a demo instance (e.g. the docker compose stack, where the host is "db").
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
if (process.env.NODE_ENV === "production" || (!isLocal && process.env.PRINTQ_DEMO !== "true")) {
  console.error("Refusing to run: only for a local development database (or PRINTQ_DEMO=true).");
  process.exit(1);
}
if (!secret) {
  console.error("BETTER_AUTH_SECRET must be set (same value the dev server uses).");
  process.exit(1);
}
if (!["member", "staff", "admin"].includes(role)) {
  console.error("Role must be member, staff or admin.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

async function main() {
  const userId = randomUUID();
  const discordId = `9${Date.now()}`.slice(0, 18);
  const name = `Dev ${role[0].toUpperCase()}${role.slice(1)}`;
  const token = randomBytes(24).toString("base64url");

  await sql.begin(async (tx) => {
    await tx`INSERT INTO printq."user" (id, name, email) VALUES (${userId}, ${name}, ${`${discordId}@discord.invalid`})`;
    await tx`INSERT INTO printq.account (id, account_id, provider_id, user_id, scope)
             VALUES (${randomUUID()}, ${discordId}, 'discord', ${userId}, 'identify')`;
    await tx`INSERT INTO printq.profiles (user_id, discord_id, discord_username, role, is_guild_member, has_verified_role, eligibility_checked_at)
             VALUES (${userId}, ${discordId}, ${`dev_${role}`}, ${role}, true, true, now() + interval '30 days')`;
    await tx`INSERT INTO printq.session (id, token, user_id, expires_at)
             VALUES (${randomUUID()}, ${token}, ${userId}, now() + interval '7 days')`;
  });

  const signature = createHmac("sha256", secret).update(token).digest("base64");
  const cookie = encodeURIComponent(`${token}.${signature}`);
  console.log(`Created ${role} "${name}".\nSet this cookie on http://localhost:3000:\n`);
  console.log(`better-auth.session_token=${cookie}`);
}

main()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
