import "server-only";
import type { APIGuildMember } from "discord-api-types/v10";
import { printqEnv } from "../env";
import { DiscordApiError, discordFetch } from "./rest";

export interface Eligibility {
  isGuildMember: boolean;
  hasVerifiedRole: boolean;
  isStaffByRole: boolean;
  username: string | null;
}

// Uses the bot token, so it can be re-checked at any time without the user's OAuth token.
export async function checkEligibility(discordUserId: string): Promise<Eligibility> {
  const env = printqEnv();
  try {
    const member = await discordFetch<APIGuildMember>(`/guilds/${env.DISCORD_SERVER_ID}/members/${discordUserId}`);
    return {
      isGuildMember: true,
      hasVerifiedRole: member.roles.includes(env.PRINTQ_VERIFIED_ROLE_ID),
      isStaffByRole: env.PRINTQ_STAFF_ROLE_ID ? member.roles.includes(env.PRINTQ_STAFF_ROLE_ID) : false,
      username: member.user?.username ?? null,
    };
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) {
      return { isGuildMember: false, hasVerifiedRole: false, isStaffByRole: false, username: null };
    }
    throw error;
  }
}
