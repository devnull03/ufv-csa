import "server-only";
import { randomUUID } from "node:crypto";
import type { APIInteraction } from "discord-api-types/v10";
import { eq } from "drizzle-orm";
import type { UserRole } from "../constants";
import { db, schema } from "../db/client";
import { printqEnv } from "../env";
import { PrintQError } from "../errors";
import { viewerForDiscordId } from "../profiles";
import { hasRole, type Viewer } from "../roles";

export const interactionUser = (interaction: APIInteraction) => interaction.member?.user ?? interaction.user;

/**
 * Who is clicking, as a PrintQ Viewer with at least `minRole`.
 *
 * Staff are recognised by their PrintQ role, or by the PRINTQ_STAFF_ROLE_ID
 * Discord role (sent with every interaction, so they needn't have signed in to
 * the website). Admins come from PrintQ or PRINTQ_ADMIN_DISCORD_IDS. A missing
 * profile is created, linked to their Discord account, so the website sign-in
 * later lands on the same user. Re-checked on every interaction.
 */
export async function requireDiscordStaff(interaction: APIInteraction, minRole: Exclude<UserRole, "member"> = "staff"): Promise<Viewer> {
  const user = interactionUser(interaction);
  if (!user) throw new PrintQError("forbidden", "Use this in the CSA server.");
  const env = printqEnv();
  const roles = interaction.member?.roles ?? [];
  const isBootstrapAdmin = env.PRINTQ_ADMIN_DISCORD_IDS.includes(user.id);
  const hasStaffRole = Boolean(env.PRINTQ_STAFF_ROLE_ID && roles.includes(env.PRINTQ_STAFF_ROLE_ID));
  const granted: UserRole | null = isBootstrapAdmin ? "admin" : hasStaffRole ? "staff" : null;

  const viewer = await viewerForDiscordId(user.id);
  if (viewer && hasRole(viewer, minRole)) return viewer;
  if (!granted || !hasRole({ role: granted }, minRole)) {
    throw new PrintQError("forbidden", minRole === "admin" ? "Only PrintQ admins can change lab hours." : "Only PrintQ staff can do this.");
  }

  const database = db();
  if (viewer) {
    await database.update(schema.profiles).set({ role: granted }).where(eq(schema.profiles.userId, viewer.userId));
    return { ...viewer, role: granted };
  }
  const userId = randomUUID();
  const name = interaction.member?.nick ?? user.global_name ?? user.username;
  await database.transaction(async (tx) => {
    await tx.insert(schema.user).values({ id: userId, name, email: `${user.id}@discord.invalid` });
    await tx.insert(schema.account).values({ id: randomUUID(), accountId: user.id, providerId: "discord", userId, scope: "identify" });
    await tx.insert(schema.profiles).values({
      userId,
      discordId: user.id,
      discordUsername: user.username,
      role: granted,
      isGuildMember: true,
      hasVerifiedRole: true,
      eligibilityCheckedAt: new Date(),
    });
  });
  return {
    userId,
    name,
    image: null,
    discordId: user.id,
    discordUsername: user.username,
    role: granted,
    ineligibleReason: null,
    bannedUntil: null,
  };
}
