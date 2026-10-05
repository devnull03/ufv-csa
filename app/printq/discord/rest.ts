import "server-only";
import { discordBotConfigured, printqEnv } from "../env";

const DISCORD_API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`Discord API responded ${status}`);
  }
}

// Plain fetch wrapper. Deliberately independent of app/(site)/api/utils.ts, which
// imports the Sanity write client and fails without Sanity secrets.
export async function discordFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!discordBotConfigured()) throw new Error("The Discord bot is not configured (or PRINTQ_DEMO is on)");
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${printqEnv().DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new DiscordApiError(response.status, await response.text());
  return (response.status === 204 ? undefined : await response.json()) as T;
}
