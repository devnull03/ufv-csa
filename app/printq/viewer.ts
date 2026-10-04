import "server-only";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { cache } from "react";
import { auth } from "./auth";
import type { UserRole } from "./constants";
import { db, schema } from "./db/client";
import { checkEligibility } from "./discord/membership";
import { printqEnv } from "./env";
import { hasRole, type Viewer } from "./roles";
import { getSettings } from "./settings";

export { hasRole, type IneligibleReason, type Viewer } from "./roles";

/** The signed-in user with a fresh-enough Discord eligibility check, or null. Memoised per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;

  const database = db();
  const [discordAccount] = await database
    .select({ accountId: schema.account.accountId })
    .from(schema.account)
    .where(and(eq(schema.account.userId, session.user.id), eq(schema.account.providerId, "discord")))
    .limit(1);
  if (!discordAccount) return null;

  let [profile] = await database
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, session.user.id))
    .limit(1);

  const { eligibilityRecheckHours } = await getSettings();
  const stale =
    !profile?.eligibilityCheckedAt ||
    Date.now() - profile.eligibilityCheckedAt.getTime() > eligibilityRecheckHours * 3_600_000;

  if (stale) {
    const discordId = discordAccount.accountId;
    const eligibility = await checkEligibility(discordId);
    const bootstrapAdmin = printqEnv().PRINTQ_ADMIN_DISCORD_IDS.includes(discordId);
    const currentRole: UserRole = profile?.role ?? "member";
    const role: UserRole = bootstrapAdmin
      ? "admin"
      : eligibility.isStaffByRole && currentRole === "member"
        ? "staff"
        : currentRole;
    const values = {
      userId: session.user.id,
      discordId,
      discordUsername: eligibility.username,
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
    userId: session.user.id,
    name: session.user.name,
    image: session.user.image ?? null,
    discordId: profile.discordId,
    discordUsername: profile.discordUsername,
    role: profile.role,
    bannedUntil: profile.bannedUntil,
    ineligibleReason: banned
      ? "banned"
      : !profile.isGuildMember
        ? "not_in_server"
        : !profile.hasVerifiedRole
          ? "missing_role"
          : null,
  };
});

// --- Page guards (server components) ---

export async function requireMemberPage(next: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/printing/login?next=${encodeURIComponent(next)}`);
  if (viewer.ineligibleReason) redirect(`/printing/login?reason=${viewer.ineligibleReason}`);
  return viewer;
}

export async function requireRolePage(role: Exclude<UserRole, "member">, next: string): Promise<Viewer> {
  const viewer = await requireMemberPage(next);
  if (!hasRole(viewer, role)) redirect("/printing");
  return viewer;
}

// --- Route handler guard ---

export async function requireApiViewer(
  role: UserRole = "member"
): Promise<{ viewer: Viewer; error?: undefined } | { viewer?: undefined; error: NextResponse }> {
  const viewer = await getViewer();
  if (!viewer) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  if (viewer.ineligibleReason) {
    return { error: NextResponse.json({ error: viewer.ineligibleReason }, { status: 403 }) };
  }
  if (!hasRole(viewer, role)) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { viewer };
}
