"use client";

import { useState } from "react";
import { Button } from "~/app/(site)/components/UI/button";
import { AppDiscordInviteLink } from "~/app/(site)/config";
import { authClient } from "../auth-client";
import type { IneligibleReason } from "../roles";
import { Placeholder } from "./Placeholder";

// Auth components. DESIGN_BRIEF §4.3 and §5.5.

const REASON_COPY: Record<IneligibleReason | "oauth_error", { title: string; body: string }> = {
  not_in_server: { title: "Join the CSA Discord first", body: "PrintQ is for members of the CSA Discord server." },
  missing_role: { title: "You need the verified role", body: "Get verified in the CSA Discord, then try again." },
  banned: { title: "Your booking access is paused", body: "Contact a CSA executive if you think this is a mistake." },
  oauth_error: { title: "Sign-in failed", body: "Something went wrong talking to Discord. Please try again." },
};

export function AuthCard({ reason, next }: { reason?: IneligibleReason | "oauth_error"; next: string }) {
  const [loading, setLoading] = useState(false);
  const copy = reason ? REASON_COPY[reason] : null;

  async function signIn() {
    setLoading(true);
    await authClient.signIn.social({
      provider: "discord",
      callbackURL: next,
      errorCallbackURL: "/printing/login?reason=oauth_error",
    });
  }

  return (
    <Placeholder name={`AuthCard${reason ? ` (${reason})` : ""}`} spec="§4.3" className="mx-auto max-w-md space-y-3">
      <h1 className="text-2xl font-bold">{copy?.title ?? "Sign in to book the 3D printer"}</h1>
      <p className="text-sm text-slate-400">
        {copy?.body ?? "We only see your Discord username and ID. We never see your email."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="information" loading={loading} onClick={signIn}>
          {reason ? "Try again" : "Sign in with Discord"}
        </Button>
        {reason === "not_in_server" && (
          <Button variant="outline" asChild>
            <a href={AppDiscordInviteLink} target="_blank" rel="noreferrer">
              Join the server
            </a>
          </Button>
        )}
      </div>
    </Placeholder>
  );
}

export function SignOutButton() {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await authClient.signOut();
        window.location.href = "/printing";
      }}
    >
      Sign out
    </Button>
  );
}
