# PrintQ: developer guide

PrintQ is the CSA 3D-printer booking system. It lives inside the main site at `/printing`, and its API is at `/api/printq/*`.

It stores its data in a local PostgreSQL database (`printq` schema) on the same UFV server as the site. Uploaded files go on that server's disk.

- **Design:** [`DESIGN_BRIEF.md`](./DESIGN_BRIEF.md). All UI is currently **placeholder** (dashed boxes labelled `PLACEHOLDER`).
- **Background:** [`../printq-integration-audit.md`](../printq-integration-audit.md).

## Status

| Area | State |
|---|---|
| DB schema + migrations (`drizzle/`) incl. no-double-booking exclusion constraint | ✅ done, tested against Postgres 16 |
| Scheduling engine (`app/printq/scheduling/`) | ✅ done, unit-tested (DST, closures, overlaps) |
| G-code / bgcode parser (`app/printq/gcode/`) | ✅ done, tested on synthetic fixtures; **add real PrusaSlicer exports** to `__tests__/fixtures/` |
| Discord login (Better Auth, `identify` scope) + bot-token membership/role check | ✅ wired; needs real Discord app credentials to test |
| Upload → parse → availability → book → approve → session lifecycle APIs | ✅ done, integration-tested |
| Pages and routes for the whole page tree | ✅ placeholder UI, real data |
| Settings editors, closures CRUD, users/roles/bans actions | ⏳ read-only placeholders; build with the real design |
| Discord `/print` commands, approval buttons, DMs, reminders | ⏳ stubs (`app/printq/discord/handlers.ts`, `jobs.ts`) |
| Room-status integration (`/sccroom` → check-in/no-show logic) | ⏳ hook in place (`app/printq/room-status.ts`) |

## Layout

```
app/printq/                 non-route code
  constants.ts              statuses, limits, default settings
  env.ts                    zod-validated env (lazy, so `next build` needs no PrintQ secrets)
  db/schema.ts, client.ts   Drizzle schema (Postgres schema "printq") + client
  auth.ts, auth-client.ts   Better Auth (Discord) server + browser clients
  viewer.ts, roles.ts       session → Viewer, eligibility re-check, page/API guards
  scheduling/               pure engine: time zones, intervals, slots, state machine
  gcode/                    .gcode/.bgcode parser
  files/                    FileStore (disk; R2/Blob can implement the same interface)
  bookings.ts               uploads, create booking, transitions, hold expiry
  schedule.ts, queries.ts   read models for pages and APIs
  jobs.ts                   periodic jobs (POST /api/printq/cron)
  discord/                  REST, membership check, /print command definition, handlers
  components/               PLACEHOLDER components named per DESIGN_BRIEF §5
app/(site)/printing/        pages (inherit the site layout)
app/(site)/api/printq/      route handlers
drizzle/                    SQL migrations (0001 is hand-written: exclusion constraint)
scripts/                    seed, dev login, Discord command registration
deploy/printq/              nginx snippet, systemd timer, backup script, dev docker-compose
```

## Local development

Requires Node 22 and Postgres 16 (local install or Docker).

```bash
cp .env.example .env.local      # set NEXT_PUBLIC_PRINTQ_ENABLED=true and BETTER_AUTH_SECRET
docker compose -f deploy/printq/docker-compose.dev.yml up -d   # or use a local Postgres
npm ci
npm run db:migrate
npm run printq:seed             # printer + placeholder lab hours (Mon–Fri 10–16)
npm run printq:dev-login -- admin   # prints a session cookie; also: member | staff
npm run dev
```

Paste the printed `better-auth.session_token=…` cookie into your browser for `http://localhost:3000` (DevTools → Application → Cookies). This signs you in without Discord.

> The existing site needs `NEXT_PUBLIC_SANITY_PROJECT_ID` to boot at all. Without real Sanity credentials, any placeholder value such as `dummy000` lets PrintQ pages render. The CMS-driven pages and lab status will be empty.

### Tests

```bash
npm test                                   # unit tests
PRINTQ_TEST_DATABASE_URL=postgres://printq:printq@localhost:5432/printq_test npm test   # + DB integration tests
```

The DB tests **truncate** the database they point at, so give them their own migrated database.

## Production checklist (UFV server)

1. **Postgres:** install Postgres 16 and create a `printq` role and database. Set `DATABASE_URL`, then run `npm run db:migrate`.
2. **Env:** set the PrintQ variables from `.env.example` in the server environment.
   - `DISCORD_CLIENT_SECRET` comes from the existing CSA Discord app (Developer Portal → OAuth2).
   - Add the redirect URI `https://csa.ufv.ca/api/printq/auth/callback/discord` in the same place.
3. **Uploads directory:** `sudo mkdir -p /var/lib/printq/uploads`, owned by the user that runs the site.
4. **nginx:** include `deploy/printq/nginx-printq.conf`. The default 1 MB body limit would reject uploads.
5. **Jobs:** install `deploy/printq/printq-cron.{service,timer}` and run `systemctl enable --now printq-cron.timer`.
6. **Backups:** schedule `deploy/printq/backup.sh` nightly and copy its output off the server.
7. **Discord command:** run `npm run discord:register` (dry run), then `npm run discord:register -- --apply`. This adds `/print` without touching `/sccroom`.
8. **Launch:** set `NEXT_PUBLIC_PRINTQ_ENABLED=true` and rebuild. The flag is inlined at build time for the nav link.
