import { redirect } from "next/navigation";
import { AuthCard } from "~/app/printq/components/auth";
import { discordLoginConfigured, isDemoMode } from "~/app/printq/env";
import { getViewer, type IneligibleReason } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const REASONS = ["not_in_server", "missing_role", "banned", "oauth_error"] as const;

// Only allow same-site relative redirects.
const safeNext = (value: string | undefined) => (value?.startsWith("/printing") ? value : "/printing");

// Screen 02 · Sign in
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const viewer = await getViewer();
  if (viewer && !viewer.ineligibleReason) redirect(next);

  const reason = viewer?.ineligibleReason ?? REASONS.find((value) => value === params.reason);
  return (
    <AuthCard
      reason={reason as IneligibleReason | "oauth_error" | undefined}
      next={next}
      discordEnabled={discordLoginConfigured()}
      demo={isDemoMode()}
    />
  );
}
