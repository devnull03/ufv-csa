import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { cache } from "react";
import { auth } from "./auth";
import type { UserRole } from "./constants";
import { viewerForUser } from "./profiles";
import { hasRole, type Viewer } from "./roles";

export { hasRole, type IneligibleReason, type Viewer } from "./roles";

/** The signed-in user with a fresh-enough Discord eligibility check, or null. Memoised per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth().api.getSession({ headers: await headers() });
  return session ? viewerForUser(session.user) : null;
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
