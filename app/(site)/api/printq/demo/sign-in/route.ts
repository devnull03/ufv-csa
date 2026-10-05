import { NextResponse } from "next/server";
import { disabledResponse } from "~/app/printq/api";
import { USER_ROLES, type UserRole } from "~/app/printq/constants";
import { demoSession } from "~/app/printq/demo";
import { isDemoMode, siteOrigin } from "~/app/printq/env";

export const dynamic = "force-dynamic";

// POST (form) role=member|staff|admin, next=/printing/... : demo mode only.
export async function POST(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  if (!isDemoMode()) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const form = await request.formData();
  const role = String(form.get("role")) as UserRole;
  if (!USER_ROLES.includes(role)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const next = String(form.get("next") ?? "");
  // A specific page wins; otherwise staff and admins land on the dashboard.
  const target = next.startsWith("/printing/") ? next : role === "member" ? "/printing" : "/printing/admin";

  const cookie = await demoSession(role);
  const response = NextResponse.redirect(new URL(target, siteOrigin()), 303);
  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: cookie.attributes.secure,
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
