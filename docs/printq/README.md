# PrintQ: developer guide

PrintQ is the CSA 3D-printer booking system. It lives inside the main site at `/printing`, and its API is at `/api/printq/*`.

It stores its data in a local PostgreSQL database (`printq` schema) on the same UFV server as the site. Uploaded files go on that server's disk.

- **Design:** the student flow (home, sign in, upload → choose time → review → sent, my prints) is built from the PrintQ design project ("Industry" re-tokened with CSA colours; theme in `app/printq/printq.css`, components in `app/printq/ui/`). Staff/admin pages are still **placeholder** UI per [`DESIGN_BRIEF.md`](./DESIGN_BRIEF.md).
- **Background:** [`../printq-integration-audit.md`](../printq-integration-audit.md).

## Status

| Area | State |
|---|---|
| DB schema + migrations (`drizzle/`) incl. no-double-booking exclusion constraint | ✅ done, tested against Postgres 16 |
| Scheduling engine (`app/printq/scheduling/`) | ✅ done, unit-tested (DST, closures, overlaps) |
| G-code / bgcode parser (`app/printq/gcode/`) | ✅ done, tested on synthetic fixtures; **add real PrusaSlicer exports** to `__tests__/fixtures/` |
| Discord login (Better Auth, `identify` scope) + bot-token membership/role check | ✅ done; full OAuth round trip integration-tested with Discord's API mocked (`discord.db.test.ts`) |
| Demo mode (`PRINTQ_DEMO=true`): demo accounts, demo data, outbox, simulated telemetry | ✅ done (see below) |
| Upload → parse → availability → book → approve → session lifecycle APIs | ✅ done, integration-tested |
| Student pages (home + 3D printer view, sign in, booking flow, my prints, booking detail) | ✅ designed UI, real data |
| Staff dashboard, approvals, session | ✅ styled, real data, working actions |
| Staff schedule, settings, users, audit pages | ✅ routes and data; ⏳ placeholder UI until designed |
| Settings editors, closures CRUD, users/roles/bans actions | ⏳ read-only placeholders; build with the real design |
| Discord `/print schedule\|mine\|cancel`, Approve/Reject buttons (+ reason modal) | ✅ done, integration-tested (`discord/handlers.ts`) |
| Notifications: request received, admin approval post, decisions, 24 h / 1 h reminders, lab-opened, expired holds | ✅ done (`notify.ts`); every message is logged to `printq.notifications` and shown on the staff dashboard |
| Room-status integration (`/sccroom` → "lab is open" DMs) | ✅ hook in place (`room-status.ts`); check-in/no-show automation still manual |
| Printer telemetry | ⏳ simulated in demo mode (`telemetry.ts`); real printer hook later |

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
  notify.ts                 Discord DMs/admin posts + outbox log (printq.notifications)
  profiles.ts               Better Auth user → PrintQ profile/Viewer
  lab-status.ts             lab open/closed (Discord /sccroom, or local in demo)
  demo.ts, telemetry.ts     demo sign-in sessions, simulated printer readings
  discord/                  REST, membership check, /print command definition, handlers
  components/               PLACEHOLDER components named per DESIGN_BRIEF §5
app/(site)/printing/        pages (inherit the site layout)
app/(site)/api/printq/      route handlers
drizzle/                    SQL migrations (0001 is hand-written: exclusion constraint)
scripts/                    seed, demo seed, dev login, Discord command registration
deploy/printq/              nginx snippet, systemd timer, backup script, dev docker-compose
```

## Try the prototype (demo mode)

Everything runs for real (Postgres, Better Auth sessions, the booking engine and state machine, the notification hooks); only the outside world is faked.

```bash
docker compose -f deploy/printq/docker-compose.dev.yml up -d   # or any local Postgres 16
cp .env.example .env.local
#   NEXT_PUBLIC_PRINTQ_ENABLED=true, PRINTQ_DEMO=true, BETTER_AUTH_SECRET=$(openssl rand -base64 32),
#   PRINTQ_CRON_SECRET=$(openssl rand -hex 32), PRINTQ_UPLOAD_DIR=./.printq-uploads,
#   NEXT_PUBLIC_SANITY_PROJECT_ID=dummy000 (if you have no Sanity project)
npm ci
npm run printq:setup            # migrate + printer/lab hours + demo people and bookings
npm run dev                     # http://localhost:3000/printing
```

Re-seed from scratch at any time with `npm run printq:demo-seed -- --reset`.

On **Sign in** pick a demo account:

| Account | Role | Try |
|---|---|---|
| Maya K. (`maya.k`) | member | upload a `.gcode`/`.bgcode`, pick a time, request; see My prints |
| Sam (`sam.staff`) | staff | Dashboard → approve/reject, run a session, open/close the lab, "Run scheduled jobs now" |
| Alex (`alex.admin`) | admin | everything, plus settings/users/audit |

What is faked in demo mode:

- **Discord membership:** everyone counts as a verified CSA member.
- **Discord messages:** nothing is sent. Every DM and admin-channel post is written to `printq.notifications` and listed under *Messages sent* on the staff dashboard.
- **Lab status:** staff toggle it on the dashboard instead of `/sccroom`. Opening it sends "the lab is open" messages to today's bookers.
- **Printer readings:** nozzle/bed/filament values are simulated.
- **Cron:** "Run scheduled jobs now" runs the same jobs as `POST /api/printq/cron` (hold expiry, reminders, upload cleanup).

**Real Discord login in demo mode:** set `DISCORD_BOT_ID` and `DISCORD_CLIENT_SECRET` of a Discord app you control, and add `http://localhost:3000/api/printq/auth/callback/discord` as an OAuth2 redirect URI. "Continue with Discord" then works next to the demo accounts. Add `DISCORD_BOT_TOKEN`, `DISCORD_SERVER_ID` and `PRINTQ_VERIFIED_ROLE_ID` and turn `PRINTQ_DEMO` off to get real membership checks and real DMs.

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
