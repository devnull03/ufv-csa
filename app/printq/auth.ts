import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "./db/client";
import { printqEnv, siteOrigin } from "./env";

export const AUTH_BASE_PATH = "/api/printq/auth";

function createAuth() {
  const env = printqEnv();
  return betterAuth({
    appName: "CSA PrintQ",
    baseURL: siteOrigin(),
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    socialProviders: {
      discord: {
        // The existing CSA Discord application; its application ID is the OAuth client ID.
        clientId: env.DISCORD_BOT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        // Only `identify`: no email address is requested or stored.
        disableDefaultScope: true,
        scope: ["identify"],
        mapProfileToUser: (profile) => ({
          name: profile.global_name || profile.username,
          email: `${profile.id}@discord.invalid`,
          emailVerified: false,
        }),
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { printqAuth?: Auth };

// Created on first use so `next build` does not need PrintQ secrets.
export function auth(): Auth {
  globalForAuth.printqAuth ??= createAuth();
  return globalForAuth.printqAuth;
}
