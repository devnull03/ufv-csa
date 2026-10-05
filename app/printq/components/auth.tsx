"use client";

import { SiDiscord } from "@icons-pack/react-simple-icons";
import { EyeOff, Loader2, User } from "lucide-react";
import { useState } from "react";
import { AppDiscordInviteLink } from "~/app/(site)/config";
import { authClient } from "../auth-client";
import type { IneligibleReason } from "../roles";

// Screen 02 · Sign in, plus the eligibility states from DESIGN_BRIEF §4.3.

const REASON_COPY: Record<IneligibleReason | "oauth_error", { title: string; body: string }> = {
  not_in_server: {
    title: "Join the CSA Discord first",
    body: "PrintQ is for members of the CSA Discord server. Join it, then sign in again.",
  },
  missing_role: {
    title: "You need the verified role",
    body: "Get verified in the CSA Discord server, then sign in again.",
  },
  banned: {
    title: "Booking access is paused",
    body: "Contact a CSA executive if you think this is a mistake.",
  },
  oauth_error: {
    title: "Sign-in didn't finish",
    body: "Something went wrong talking to Discord. Please try again.",
  },
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
    <div className="flex justify-center py-10 max-[759px]:py-2">
      <div className="pq-panel flex w-full max-w-[440px] flex-col gap-[22px] p-8 max-[759px]:p-6">
        <div className="flex flex-col gap-2">
          <span className="pq-overline">PrintQ · Sign in</span>
          <h2>{copy?.title ?? "Sign in to book"}</h2>
          <p className="pq-soft" style={{ textWrap: "pretty" }}>
            {copy?.body ?? "Use the Discord account that's in the CSA server. We'll DM you when your print is approved."}
          </p>
        </div>
        <button type="button" className="btn btn-discord btn-lg" onClick={signIn} disabled={loading}>
          {loading ? <Loader2 size={18} strokeWidth={1.5} className="pq-spin" aria-hidden /> : <SiDiscord size={18} aria-hidden />}
          {reason ? "Try again with Discord" : "Continue with Discord"}
        </button>
        {reason === "not_in_server" ? (
          <a href={AppDiscordInviteLink} target="_blank" rel="noreferrer" className="btn btn-secondary btn-md">
            Join the CSA server
          </a>
        ) : null}
        <div className="pq-rule-t pq-muted flex flex-col gap-2 pt-4 text-[13px]">
          <span className="flex items-center gap-2">
            <User size={14} strokeWidth={1.5} aria-hidden />
            We read your username and CSA member role.
          </span>
          <span className="flex items-center gap-2">
            <EyeOff size={14} strokeWidth={1.5} aria-hidden />
            Your name never appears on the public schedule.
          </span>
        </div>
      </div>
    </div>
  );
}

export function SignOutButton() {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={async () => {
        await authClient.signOut();
        window.location.href = "/printing";
      }}
    >
      Sign out
    </button>
  );
}
