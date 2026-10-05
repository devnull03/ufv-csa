import "server-only";
import { createHmac } from "node:crypto";
import { auth } from "./auth";
import type { UserRole } from "./constants";
import { db, schema } from "./db/client";

/** Fixed demo accounts offered on the sign-in page in demo mode. Discord IDs are fake. */
export const DEMO_ACCOUNTS: Record<UserRole, { userId: string; name: string; username: string; discordId: string }> = {
  member: { userId: "demo-member", name: "Maya K.", username: "maya.k", discordId: "900000000000000001" },
  staff: { userId: "demo-staff", name: "Sam (staff)", username: "sam.staff", discordId: "900000000000000002" },
  admin: { userId: "demo-admin", name: "Alex (admin)", username: "alex.admin", discordId: "900000000000000003" },
};

/** Creates (or reuses) a demo account and returns a signed session cookie for it. */
export async function demoSession(role: UserRole) {
  const account = DEMO_ACCOUNTS[role];
  const database = db();
  await database
    .insert(schema.user)
    .values({ id: account.userId, name: account.name, email: `${account.discordId}@discord.invalid` })
    .onConflictDoNothing();
  await database
    .insert(schema.account)
    .values({ id: `${account.userId}-discord`, accountId: account.discordId, providerId: "discord", userId: account.userId, scope: "identify" })
    .onConflictDoNothing();
  const profile = {
    userId: account.userId,
    discordId: account.discordId,
    discordUsername: account.username,
    role,
    isGuildMember: true,
    hasVerifiedRole: true,
    eligibilityCheckedAt: new Date(),
    bannedUntil: null,
  };
  await database.insert(schema.profiles).values(profile).onConflictDoUpdate({ target: schema.profiles.userId, set: profile });

  const context = await auth().$context;
  const session = await context.internalAdapter.createSession(account.userId);
  // Same format Better Auth uses for signed cookies: "<token>.<base64 HMAC-SHA256>".
  const signature = createHmac("sha256", context.secret).update(session.token).digest("base64");
  const cookie = context.authCookies.sessionToken;
  return { name: cookie.name, value: `${session.token}.${signature}`, attributes: cookie.attributes };
}
