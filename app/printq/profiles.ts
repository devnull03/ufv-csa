import "server-only";
import { and, eq } from "drizzle-orm";
import type { UserRole } from "./constants";
import { db, schema } from "./db/client";
import { checkEligibility } from "./discord/membership";
import { printqEnv } from "./env";
import type { Viewer } from "./roles";
import { getSettings } from "./settings";

/**
 * Builds the Viewer for a signed-in user: finds their Discord account, and
 * (re)checks server membership and roles when the cached check is stale.
 * Returns null for users without a linked Discord account.
 */
export async function viewerForUser(user: { id: string; name: string; image?: string | null }): Promise<Viewer | null> {
  const database = db();
  const [discordAccount] = await database
    .select({ accountId: schema.account.accountId })
    .from(schema.account)
    .where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "discord")))
    .limit(1);
  if (!discordAccount) return null;

  let [profile] = await database.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).limit(1);

  const { eligibilityRecheckHours } = await getSettings();
  const stale =
    !profile?.eligibilityCheckedAt || Date.now() - profile.eligibilityCheckedAt.getTime() > eligibilityRecheckHours * 3_600_000;

  if (stale) {
    const discordId = discordAccount.accountId;
    const eligibility = await checkEligibility(discordId);
    const bootstrapAdmin = printqEnv().PRINTQ_ADMIN_DISCORD_IDS.includes(discordId);
    const currentRole: UserRole = profile?.role ?? "member";
    const role: UserRole = bootstrapAdmin ? "admin" : eligibility.isStaffByRole && currentRole === "member" ? "staff" : currentRole;
    const values = {
      userId: user.id,
      discordId,
      discordUsername: eligibility.username ?? profile?.discordUsername ?? null,
      role,
      isGuildMember: eligibility.isGuildMember,
      hasVerifiedRole: eligibility.hasVerifiedRole,
      eligibilityCheckedAt: new Date(),
    };
    [profile] = await database
      .insert(schema.profiles)
      .values(values)
      .onConflictDoUpdate({ target: schema.profiles.userId, set: values })
      .returning();
  }

  const banned = profile.bannedUntil !== null && profile.bannedUntil > new Date();
  return {
    userId: user.id,
    name: user.name,
    image: user.image ?? null,
    discordId: profile.discordId,
    discordUsername: profile.discordUsername,
    role: profile.role,
    bannedUntil: profile.bannedUntil,
    ineligibleReason: banned ? "banned" : !profile.isGuildMember ? "not_in_server" : !profile.hasVerifiedRole ? "missing_role" : null,
  };
}

/** The Viewer for a Discord user (used by bot interactions), or null if they never signed in to PrintQ. */
export async function viewerForDiscordId(discordId: string): Promise<Viewer | null> {
  const [row] = await db()
    .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
    .from(schema.profiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.profiles.userId))
    .where(eq(schema.profiles.discordId, discordId))
    .limit(1);
  return row ? viewerForUser(row) : null;
}
