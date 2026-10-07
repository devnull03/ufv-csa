# Running the site + PrintQ in containers

`docker-compose.yml` (repo root) runs the whole thing on your machine with two containers: the Next.js site with PrintQ, and Postgres. It works with Docker Compose and with Podman.

## Quick start (demo mode, no Discord needed)

```bash
git clone … && cd ufv-csa && git checkout feat/printq-local
cp .env.example .env
# Fill in the two REQUIRED secrets:
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" .env
sed -i "s|^PRINTQ_CRON_SECRET=.*|PRINTQ_CRON_SECRET=$(openssl rand -hex 32)|" .env

docker compose up --build        # or: podman compose up --build
```

The first build takes a few minutes. Then:

- open http://localhost:3000/printing and sign in with a demo account (**Member**, **Staff** or **Admin**);
- as staff, **Staff → Discord** is a clickable copy of the Discord channels. Every button there runs the real bot code;
- **Staff → Schedule** and **Settings** edit closures, lab hours and the printer model.

Stop with `Ctrl+C` or `docker compose down`. Data survives in volumes; `docker compose down -v` wipes it.

## What runs

| Service | What it does |
|---|---|
| `db` | Postgres 16. Data in the `pgdata` volume. Reachable from your machine on `127.0.0.1:${POSTGRES_PORT}` (5432) for `psql`. |
| `web` | The site, production build, on `http://localhost:${WEB_PORT}` (3000). Uploaded G-code is kept in the `uploads` volume. |

There's no separate setup or cron container. On every start, the site does both itself (`instrumentation.ts` → `app/printq/setup/`):

1. **Setup:** apply database migrations, add the printer and placeholder lab hours if missing, and add demo data when `PRINTQ_DEMO=true`. Each step skips what's already there, and a database lock keeps two servers from doing it at once. Turn it off with `PRINTQ_AUTO_SETUP=false`.
2. **Scheduled jobs:** every 5 minutes, PrintQ's jobs run: expire requests nobody reviewed in time, send reminders, delete old uploads, refresh the Discord boards. Turn it off with `PRINTQ_SCHEDULER=false` if something external calls `POST /api/printq/cron` instead.
3. **The site's own jobs** (Discord event reminders, UFV news) are still called by their existing external scheduler. To move them here later, set `SCHEDULE_EVENT_REMINDERS_MINUTES` / `SCHEDULE_UFV_NEWS_MINUTES` and switch the external caller off.

## Configuration: `.env` vs Postgres

**`.env`** holds only secrets, Discord IDs and switches; every variable is explained in `.env.example`. **Postgres** holds everything staff change while PrintQ runs, edited on the website or from Discord. None of the second list goes in `.env`.

| In `.env` | In Postgres (edit in the app) |
|---|---|
| Discord app: application ID, public key, bot token, OAuth client secret | Lab hours (Settings, or `/printstaff hours`) |
| Discord server ID; channel IDs (staff channel, public board, existing site channels); role IDs (verified member, PrintQ staff, SCC room) | Closures and maintenance (Schedule, the Discord board, `/printstaff close`) |
| Admin Discord user IDs (bootstrap) | Booking rules: hold time, max print length, quotas, lead time (`printq.settings`) |
| `BETTER_AUTH_SECRET`, `PRINTQ_CRON_SECRET` | Which i3 variant the printer is, and its build volume (Settings → Printer) |
| Sanity project ID/dataset/token, site domain | Who is staff/admin beyond the bootstrap IDs, and bans |
| `PRINTQ_DEMO`, `NEXT_PUBLIC_PRINTQ_ENABLED` | Bookings, uploads, the message log, Discord message IDs, lab status in demo mode |

`NEXT_PUBLIC_*` values are baked into the build. After changing one, run `docker compose up --build`. Everything else only needs `docker compose up -d` (it restarts with the new `.env`).

## Testing with real Discord

1. **Use a separate test Discord application and a test server, not the CSA app.** A Discord app has one Interactions Endpoint URL. Pointing the real CSA app at your machine would send everyone's `/sccroom` and `/print` commands to it.
2. In the test app's Developer Portal:
   - OAuth2 → add the redirect `http://localhost:3000/api/printq/auth/callback/discord`;
   - copy the Application ID, Public Key, Bot Token and Client Secret into `.env`;
   - invite the bot to your test server with View Channels, Send Messages, Embed Links, Create Public Threads, Send Messages in Threads and Manage Messages.
3. Fill in `DISCORD_SERVER_ID`, `PRINTQ_VERIFIED_ROLE_ID`, `PRINTQ_STAFF_ROLE_ID`, `PRINTQ_ADMIN_CHANNEL_ID` and your own ID in `PRINTQ_ADMIN_DISCORD_IDS`. Set `PRINTQ_DEMO=false`, then `docker compose up -d`.
4. "Continue with Discord" now works on localhost. Cards and the board post to your staff channel.
5. Buttons and slash commands need Discord to reach you over public HTTPS:
   - run `cloudflared tunnel --url http://localhost:3000`, set `SITE_DOMAIN` to the tunnel's host name, and `docker compose up -d`;
   - set the test app's Interactions Endpoint URL to `https://<tunnel host>/api/webhooks/discord/interact`;
   - register the commands from your checkout: `npm ci && npm run discord:register -- --apply` (reads `.env.local`, so copy the Discord values there).

## Handy commands

```bash
docker compose logs -f web                       # site logs (setup and scheduler lines start with [printq] / [scheduler])
docker compose exec db psql -U printq printq     # SQL shell
docker compose restart web                       # re-run setup, e.g. after pulling new migrations
docker compose down -v                           # stop and delete all data
```

Fresh demo data: **Reset demo data** on the staff dashboard (demo mode).

## Podman notes

- `podman compose` uses `docker-compose` if it's installed, otherwise `podman-compose`. With `podman-compose`, use **1.1 or newer**, which supports `depends_on: condition` (the site waits for the database to be healthy). Even without it, the site retries the database for 30 s on start.
- Only named volumes are used, so SELinux relabelling (`:Z`) isn't needed.
- The image is tagged `localhost/ufv-csa-web`. Base images are pulled by their full `docker.io/...` names, so Podman doesn't prompt for a registry.

## How the image is built

The `Dockerfile` has three stages:

1. `deps`: `npm ci`.
2. `builder`: the production build.
3. `runner`: about 210 MB, only Next's standalone server and the SQL migrations, run as the unprivileged `node` user.

The build uses Next's *compile* mode, so it never needs to reach Sanity or Postgres; every page renders on request instead. That's why the image builds with a placeholder Sanity project ID. The CMS pages (home, events, announcements…) only work with the real `NEXT_PUBLIC_SANITY_PROJECT_ID`, which is public: find it in sanity.io/manage or the Vercel project settings. PrintQ works either way.

For `npm run dev` without containers, `deploy/printq/docker-compose.dev.yml` still starts just Postgres; see [README.md](./README.md).
