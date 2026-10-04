# PrintQ Integration Audit: UFV CSA website (v2)

- **Audit date:** 2026-10-04.
- **Repo audited:** `devnull03/ufv-csa` at commit `9b4c6f4`, which is identical to `origin/master`. The upstream repo is `DevelopsS15/ufv-csa`.
- **Scope:** read-only on existing code. This document is the only file added.
- **Labels used throughout:**
  - **[Verified]**: checked in code, by command, or against a primary doc fetched on the audit date.
  - **[Inference]**: my reasoning, not confirmed.
  - **[Unverified]**: could not be checked. The text says what is needed to check it.

### What changed since v1

1. **Hosting corrected.** v1 guessed Vercel. The live site is actually **self-hosted on a UFV server**: nginx 1.18 on Ubuntu runs `next start` from IP `198.162.116.23`, which is in UFV's ARIN netblock `NET-198-162-96-0-1`. See §2.3.
2. **New platform analysis.** §3 covers what can move to Cloudflare and three storage plans:
   - **L**: a local Postgres database on the UFV server;
   - **C**: Cloudflare (D1, R2, Cron Triggers);
   - **V**: Vercel with Neon and Blob.

   Supabase is now optional, not assumed.
3. **PrintQ goes into the existing CSA Discord application**, not a new bot. §4 covers who owns it and how to integrate safely.
4. **New audit** of `suchmememanyskill/3d-print-queue-discord-bot`. §5 concludes: reuse ideas, not code.
5. **Lab hours design.** §6 combines admin-set lab hours with the existing `/sccroom` open/closed signal, plus a roadmap for connecting the printer directly (PrusaLink).
6. **Repo ownership removed as a concern**, at your direction. Operational access (SSH, Discord portal, Sanity) is still listed because work can't ship without it.
7. **Platform limits re-verified** against primary docs, which were reachable this time (Appendix §11.2).

---

## 1. Summary

1. **Today:** the site is a Next.js 15.5 App Router + TypeScript + Tailwind 3 + shadcn/ui app with a Sanity CMS. It runs as a long-lived Node process on a **UFV-owned server** behind nginx [Verified]. It already has a signed Discord HTTP-interactions endpoint (`/sccroom`) and no user auth.
2. **Recommendation for PrintQ v1: Plan L.** Put PrintQ inside the existing app (`/printing`, `/api/printq`) and use **Postgres on the same UFV server**, files on local disk, and a systemd timer for jobs.
   - This needs no new vendors, no DNS change, no free-tier pausing and no body-size limits.
   - It is also the **only plan where a future direct printer link (PrusaLink, LAN-only) works without an extra on-site agent**.
3. **Write it to be portable:** Drizzle ORM, Better Auth (Discord), and storage and scheduler interfaces. That keeps a later move to **Cloudflare (Plan C)** or **Vercel + Neon (Plan V)** a configuration change, not a rewrite.
4. **Cloudflare:**
   - **Almost everything can move** via `@opennextjs/cloudflare`, with D1, R2, Cron Triggers and Queues.
   - Two hard constraints:
     - (a) the Workers Free plan allows **10 ms of CPU per request**, so SSR, Sanity webhook processing and G-code parsing realistically need **Workers Paid at $5/mo**;
     - (b) `csa.ufv.ca` is a **UFV DNS name**, so any move off the UFV server needs UFV IT to change DNS.
   - Sanity Studio should move to Sanity's free hosted studio, and `next/image` + `sharp` should switch to Sanity's image CDN.
5. **Vercel fallback (Plan V):** Neon Postgres (free tier: 1 GB, scales to zero after 5 minutes), Vercel Blob with client uploads (direct from the browser, so the 4.5 MB function payload limit doesn't apply), and an external 15-minute scheduler. Hobby cron is once per day, and Vercel's Hobby plan is "non-commercial, **personal** use only", which is a fit risk for a student association.
6. **Discord:** PrintQ commands and buttons go through the **existing** endpoint `/api/webhooks/discord/interact` (live, returns 401 to unsigned requests [Verified]) via a dispatch to `app/printq/discord/*`. **The app owner is not discoverable from code.** It's whoever holds `DISCORD_BOT_ID` in the developer portal (most likely `DevelopsS15`, [Inference]). Move the app into a Discord **Team** (§4).
7. **The suggested bot repo is not reusable as code.** It's a GPL-3.0 Python gateway bot that manages a URL wishlist stored on the author's own server. It has no scheduling, approvals, G-code handling or access control. Reuse only UX ideas (§5).
8. **Lab hours:** admin-defined weekly hours plus closures decide **when a print may start** (and must finish, if attended-only). The live `/sccroom` status is used for check-in grace and no-show logic, and as a "lab is open now" badge (§6).
9. **Health:** install ✅, lint ✅, typecheck ✅. The build compiles but needs Sanity env vars. There are no tests and no CI. 24 `npm audit` findings, mostly in Studio and dev tooling. No secrets found in the current tree or in **full git history** (129 commits).
10. **Biggest risks:**
    - access to and patch level of the UFV server (nginx 1.18 suggests Ubuntu 20.04 or 22.04);
    - Discord app ownership;
    - personal data in the public repo (`assets/sanity-prd.tar.gz`), plus `/api/room-status` publicly exposing the last toggler's Discord ID.

---

## 2. Current State Inventory

### 2.1 Framework and tooling [Verified]

| Item | Finding | Evidence |
|---|---|---|
| Framework | Next.js **15.5.25** App Router, React **18.3.1** | `package.json`; `npx next --version` |
| Language | TypeScript 5.9 (`strict: true`), path alias `~/*` | `tsconfig.json` lines 7, 22-26 |
| Package manager | npm, lockfile v3 | `package-lock.json` |
| Node version | Not pinned (no `.nvmrc` or `engines`). The sandbox used Node 22.22.0. | `package.json` |
| Monorepo | No | root |
| Build | `next build` then `postbuild: next-sitemap` | `package.json` scripts |
| Experimental | `experimental.taint: true`, which keeps the Sanity write token server-only | `next.config.mjs` 13-15; `app/sanity/lib/token.ts` 9-13 |
| Overrides drift | The postcss 8.5.28 override is **not applied**. `npm ls` shows `next/node_modules/postcss@8.4.31 invalid`. | `package.json` 11-21 |

### 2.2 Rendering and routing [Verified]

- **Two root layouts:**
  - `app/(site)/layout.tsx`: public site; forces the dark theme with `<html className="dark">` at line 41.
  - `app/(studio)/studio/[[...index]]/layout.tsx`: embedded Sanity Studio at `/studio`, which returns HTTP 200 live.
- Pages are server components reading Sanity, cached with `next: { tags }` (`app/sanity/lib/query.ts` 24-25, 79-80, 228-229, 276-277, 319-320). Webhooks revalidate them on demand with `revalidateTag` and `revalidatePath`, and dynamic routes use `generateStaticParams` (for example `events/[slug]/page.tsx:79`).
- Live responses confirm prerendering: `x-nextjs-prerender: 1`, `x-nextjs-cache: HIT`, `Cache-Control: s-maxage=31536000` on `/` [Verified, live].
- Per-route file convention: `page.tsx` + `root.tsx` + `loading.tsx` + `error.tsx`.
- There is **no `middleware.ts`**. `/printing` and `/privacy` both return **404** live, so both paths are free.

### 2.3 Hosting and deployment [Verified unless marked]

| Item | Finding |
|---|---|
| Server | Response headers: `Server: nginx/1.18.0 (Ubuntu)` and `X-Powered-By: Next.js`. That is a **self-hosted `next start` behind an nginx reverse proxy**. |
| Network owner | ARIN RDAP for `198.162.116.23` → `NETBLK-UCFV1`, range `198.162.96.0–198.162.119.255`, registrant **University of the Fraser Valley**. |
| OS age | nginx 1.18.0 is the stock package on Ubuntu 20.04 and 22.04 [Inference]. **If it is 20.04, standard support ended in 2025.** Check with `lsb_release -a`. |
| Deploy method | Nothing in the repo (no Dockerfile, PM2/ecosystem file, systemd unit, or GitHub Actions; 0 workflow runs). Probably an SSH `git pull && npm ci && npm run build` and a process manager restart [Inference]. |
| Scheduler | `/api/events/reminders` and `/api/announcements/ufv-news` are protected by a static `authorization` header (`api/events/reminders/route.ts` 11-24; `api/announcements/ufv-news/route.ts` 14-27), and nothing in the repo calls them. Probably a **crontab on the same server** [Inference]. |
| DNS | `csa.ufv.ca` A record → `198.162.116.23`. **`ufv.ca` is UFV's zone**, so changing where `csa.ufv.ca` points needs UFV IT [Inference, high confidence]. |
| HTTP | Port 80 was blocked by the sandbox proxy, so the HTTP→HTTPS redirect is untested. |
| Preview/staging | None known. |

**To confirm, run on the server** (no secrets needed):

```
lsb_release -a
node -v
systemctl list-units | grep -iE 'next|node|pm2'
pm2 ls
crontab -l
sudo crontab -l
ls /etc/nginx/sites-enabled
nginx -T | grep -E 'client_max_body_size|proxy_pass'
psql --version
df -h
```

Also find out who has SSH or sudo access, and whether UFV IT manages patching.

### 2.4 Backend and services [Verified]

| Service | Use | Files |
|---|---|---|
| Sanity CMS | Events, announcements, executives, minutes, room status, Discord bookkeeping | `app/sanity/schemas/*`, `app/sanity/lib/query.ts`, `app/(site)/client.ts`, `serverClient.ts` |
| Sanity webhook → Discord | Signed with `parseBody(req, secret)`. Posts and updates messages and scheduled events. | `app/(site)/api/webhooks/sanity/events/route.ts` (737 lines). Its idempotency guard is an in-memory `cache-manager` store (47-50, 88-96) **plus** a Sanity `idempotencyKey` doc (106). |
| Discord REST | `@discordjs/rest` with the bot token | `app/(site)/api/utils.ts` 15-17 |
| Discord interactions | `/sccroom` | `app/(site)/api/webhooks/discord/interact/route.ts` |
| UFV urgent-news RSS → Discord | Cron-style route | `api/announcements/ufv-news/route.ts` |
| Umami analytics | Script tag | `app/(site)/layout.tsx` 52-56 |
| Database / ORM | **None** besides Sanity | — |

### 2.5 Auth and admin [Verified]

- There is no end-user login, session or cookie handling.
- The admin UI is **Sanity Studio** (Sanity project members).
- Discord-side privilege comes from roles: `/sccroom` requires `DISCORD_SCC_ROOM_ROLE_ID` (`interact/route.ts` 61-63).
- `executives` documents store `discordId` and `isCurrent` (`app/sanity/schemas/executives.ts` 45-47, 110-112).

### 2.6 Existing Discord integration [Verified]

- Env vars: `DISCORD_BOT_TOKEN`, `DISCORD_BOT_ID` (the application ID), `DISCORD_PUBLIC_KEY`, `DISCORD_SERVER_ID`, and channel and role IDs.
- Request verification: Ed25519 over the raw body with `tweetnacl` (`app/(site)/utils.tsx` 216-259). There is **no timestamp freshness check**, and the typed union only covers Ping and ChatInput (`utils.tsx` 224-229, 254-256), so buttons are not modelled.
- `/sccroom` handling:
  1. It sends a REST deferred callback (`interact/route.ts` 100-107).
  2. It renames the channel, posts an embed and writes a `roomStatus` doc (109-147).
  3. It sends a follow-up and revalidates `roomStatus` (149-162).
- **There is no command-registration script in the repo or its history** (searched all 129 commits), so `/sccroom` was registered by hand by whoever holds the bot token.
- Public values: server ID `287455376994205716` (`config.ts:16`; the live widget names it "Computing Students Association (CSA)") and invite `discord.gg/nu4kTTR`.

### 2.7 Design system [Verified]

Unchanged from v1, condensed here so a designer can match it exactly.

- **Stack:** Tailwind 3.4, shadcn "default" style with slate base and CSS variables (`components.json`), and components in `app/(site)/components/UI/`. Also Radix, `lucide-react` 0.349, `@icons-pack/react-simple-icons`, `sonner` and `react-day-picker` 8.
- **Theme:** dark is forced (`layout.tsx:41`, and the `next-themes` provider is commented out in `LayoutWrapper.tsx`). Font is Inter (`layout.tsx` 2, 13).
- **Dark tokens** (`app/globals.css` 38-66):

  | Token | Value |
  |---|---|
  | `--background`, `--card`, `--popover` | `222.2 84% 4.9%` |
  | `--foreground` | `210 40% 98%` |
  | `--primary` | `210 40% 98%` |
  | `--secondary`, `--muted`, `--accent`, `--border`, `--input` | `217.2 32.6% 17.5%` |
  | `--muted-foreground` | `215 20.2% 65.1%` |
  | `--destructive` | `0 62.8% 30.6%` |
  | `--ring` | `212.7 26.8% 83.9%` |
  | `--radius` | `0.5rem` |

  Light tokens are at lines 6-36.
- **Brand colors** (`config.ts` 7-10): `#36853f`, `#8fc63d`, `#52a040`.
- **Surfaces actually used** (hard-coded classes rather than tokens):
  - page body: `bg-slate-100 dark:bg-slate-800` (`layout.tsx:47`);
  - nav and footer: `bg-slate-200 dark:bg-slate-900` with `border-slate-400 dark:border-slate-700` (`NavBar.tsx:8`, `Footer.tsx:21`);
  - content width: `w-11/12 md:w-10/12 lg:w-9/12 mx-auto` (`NavBar.tsx:9`).
- **Buttons** have custom variants `information`, `success`, `warning`, `danger`, `ghost` and `theme` (`UI/button.tsx` 8-43).
- **Container:** `2rem` padding, `2xl` = 1400px (`tailwind.config.ts` 13-19).
- **Missing shadcn components:** calendar, card, form, textarea, alert.

### 2.8 Layout, nav, SEO [Verified]

- Nav links are **duplicated** between `NavBar.tsx` (11-25) and `NavBarSliderPanel.tsx` (33-62), and the "About" popover is a third list (`NavBarAboutDropdown.tsx`).
- Footer hover class `hover:text-[${AppLogoBlendedGreen}]` is built at runtime, so Tailwind never generates it (`Footer.tsx:19`).
- Metadata title template and Google verification tag (`layout.tsx` 15-25).
- `next-sitemap` excludes `/studio/*` and `/api/*`. The live `robots.txt` allows everything.

### 2.9 Environment variables (names only) [Verified]

| Group | Variables |
|---|---|
| Cron auth | `AUTH_TOKEN_EVENT_REMINDERS`, `AUTH_TOKEN_UFV_NEWS` |
| Discord channels | `DISCORD_ANNOUNCEMENT_CHANNEL_ID_CSA`, `DISCORD_ANNOUNCEMENT_CHANNEL_ID_IEEE`, `DISCORD_EVENT_CHANNEL_ID`, `DISCORD_EVENT_REMINDER_CHANNEL_ID`, `DISCORD_SCC_ROOM_CHANNEL_ID`, `DISCORD_UFV_NEWS_CHANNEL_ID` |
| Discord app and server | `DISCORD_BOT_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_SCC_ROOM_ROLE_ID`, `DISCORD_SERVER_ID`, `DISCORD_SERVER_INVITE_LINK` |
| Sanity | `NEXT_PUBLIC_SANITY_DATASET`, `NEXT_PUBLIC_SANITY_PROJECT_ID`, `SANITY_API_WRITE_TOKEN`, `SANITY_WEBHOOK_MESSAGE_SECRET` |
| Other | `NEXT_PUBLIC_UMAMI_ANALYTICS_SITE_ID`, `SITE_DOMAIN` |

There is no `.env.example` and no validation. `app/sanity/lib/token.ts` throws at import time if the write token is missing.

### 2.10 Content [Verified]

Events, announcements, executives and minutes are edited in Sanity Studio. Publishing fires a webhook that posts to Discord. The history, regulations, constitution and SCC pages are hard-coded TSX.

### 2.11 Quality tooling and local results [Verified]

| Step | Result | Time |
|---|---|---|
| `npm ci` | ✅ 1,543 packages | 30 s |
| `npm run lint` | ✅ clean. `next lint` is deprecated and removed in Next 16. | 4 s |
| `npx tsc --noEmit` | ✅ | 8 s |
| Tests | none exist | — |
| `npm run build` without env | ❌ Compiles in 70 s, then fails collecting page data: `Configuration must contain projectId`. Needs the Sanity env vars; no values were guessed. | 82 s |

There is no CI, no Prettier config and no pre-commit hooks.

### 2.12 Dependency health [Verified, 2026-10-04]

- **`npm audit`: 24 findings** (20 high, 3 moderate, 1 low).
  - Most are in Sanity Studio and CLI tooling, `eslint-config-next` and `next-sitemap`.
  - Runtime-relevant:
    - `next` (moderate; the fix is Next 16);
    - postcss bundled in `next` (8.4.31, because the override is not applied);
    - `next-sanity` (fixed in patch release 11.6.13);
    - `dompurify`;
    - `markdown-it`.
- **Majors behind:**

  | Package | Current | Latest |
  |---|---|---|
  | next | 15 | 16 |
  | react | 18 | 19 |
  | tailwindcss | 3 | 4 |
  | sanity | 4 | 6 |
  | next-sanity | 11 | 13 |
  | zod | 3 | 4 |
  | lucide-react | 0.349 | 1.x |
  | eslint | 9 | 10 |
  | typescript | 5.9 | 7 |

- **Deprecated:** `next lint`, `tsconfck` (flagged unmaintained), `@sanity/block-content-to-markdown`.

### 2.13 Secrets and personal data [Verified]

- **No credentials** in the working tree or in **full git history**. A scan for token patterns across all 129 commits matched only lockfile `integrity` hashes and base64 image data in `.pixil` files.
- **Personal data in the public repo:** `assets/sanity-prd.tar.gz` (Sanity export dated 2025-05-22) contains:
  - `roomStatus.discordUserId` (117 documents);
  - `executives.fullName`, `discordId` and `discordUsername` (34 documents);
  - meeting attendance records.
- **Live leak:** `GET https://csa.ufv.ca/api/room-status` returns the **Discord user ID of the last person who toggled the room** [Verified]. That's minor, but unnecessary.

---

## 3. Hosting and Data Platform Options

### 3.1 Platform limits (from primary docs fetched 2026-10-04)

| Platform | Limit that matters for PrintQ | Source |
|---|---|---|
| **Cloudflare Workers Free** | **10 ms CPU per request**; 100,000 requests/day; 128 MB memory; 50 subrequests per request; 5 Cron Triggers per account | `developers.cloudflare.com/workers/platform/limits` (updated 2026-09-05) |
| Cloudflare Workers Paid | **$5/mo minimum**; 10M requests and 30M CPU-ms included; up to 5 min CPU per request | `/workers/platform/pricing` |
| Worker size | 64 MiB uncompressed on both plans, "no compressed size limit" | CF limits page. **The OpenNext page still quotes 3 MiB / 10 MiB compressed**, which is stale. Trust the CF page, but test a real build. |
| CF request body | 100 MB on the Free zone plan | CF limits page |
| `waitUntil` | Work may continue up to **30 s** after the response | CF limits page |
| D1 Free | 500 MB per database; 5 GB per account; 5M rows read/day; **100k rows written/day**; 50 queries per invocation; 7-day Time Travel | `/d1/platform/limits`, `/d1/platform/pricing` |
| R2 Free | 10 GB-month storage, 1M Class A ops, 10M Class B ops, free egress | `/r2/pricing` |
| Durable Objects | Available on Free (SQLite-backed only) | `/durable-objects/platform/pricing` |
| Queues Free | 10,000 operations/day | `/queues/platform/pricing` |
| OpenNext Cloudflare | Supports Next 16 and "latest minors of 14 and 15" | `opennext.js.org/cloudflare` |
| **Vercel Functions** | **4.5 MB request/response payload**; Hobby 300 s max duration and 2 GB memory | `vercel.com/docs/functions/limitations` |
| Vercel Cron, Hobby | **Once per day**, ±59 min precision (100 jobs) | `vercel.com/docs/cron-jobs/usage-and-pricing` |
| Vercel Hobby terms | "restricts users to **non-commercial, personal use only**" | `vercel.com/docs/plans/hobby` |
| Vercel Blob, Hobby | 1 GB/month included. Client Uploads go browser → Blob and bypass the function payload limit. | `vercel.com/docs/vercel-blob/usage-and-pricing` |
| Neon Free | 1 GB per project (20 GB per account); 100 CU-hours per project; **scale-to-zero after 5 min, cannot be disabled** | `neon.com/pricing` |
| Supabase Free | 500 MB DB; 1 GB files; **50 MB max file size**; **paused after 1 week of inactivity**; 2 projects | `supabase.com/pricing`; `/docs/guides/storage/uploads/file-limits` |
| Discord | Initial response within **3 s**; token valid **15 min** | `discord.com/developers/docs/interactions/receiving-and-responding` |

### 3.2 How much of the current site can move to Cloudflare?

| Component | Move to Cloudflare? | What changes |
|---|---|---|
| Next.js pages and API routes | ✅ via `@opennextjs/cloudflare` (Next 15 supported) | Add `wrangler.jsonc` and `open-next.config.ts`. ISR and `revalidateTag` need OpenNext's incremental cache (R2 or KV), tag cache (D1) and revalidation queue (Durable Object). **Free plan risk:** SSR CPU commonly runs 10-20 ms per request (Cloudflare's own docs say so), so dynamic pages may hit error 1102. Budget for Workers Paid. |
| Sanity Studio (`/studio`) | ⚠️ Possible, but heavy | **Recommended:** move it to Sanity's free hosted studio (`sanity deploy` → `<name>.sanity.studio`) and delete the `(studio)` route group. This also removes most of the Studio-related audit findings from the site bundle. |
| `next/image` + `sharp` | ⚠️ `sharp` doesn't run on Workers | Use a custom loader backed by **Sanity's image CDN** (images already come from `cdn.sanity.io`; `next.config.mjs` 6-11). Mark the few local `/public` images `unoptimized`. |
| `@discordjs/rest` | ⚠️ Probably works with `nodejs_compat`; untested [Unverified] | Fallback: a ~40-line `fetch` wrapper. |
| `pino` logger | ⚠️ Plain stdout logging should work [Unverified] | Or switch to `console`, since Workers Logs captures it. |
| In-memory idempotency cache (`cache-manager`) | ⚠️ Per-isolate on Workers, so it can't be trusted across requests | Already backed by the Sanity `idempotencyKey` doc. Optionally move it to KV or D1. |
| Sanity webhook and Discord interactions | ✅ | Workers are a good fit for these. Use `ctx.waitUntil` (30 s) or `after()` for follow-ups. |
| Cron routes (reminders, ufv-news) | ✅ **Cron Triggers** (5 free) | This replaces the server crontab. |
| **PrintQ DB** | ✅ **D1** (SQLite) | There is no `tstzrange` or exclusion constraint. Store `start_ts`/`end_ts` as integers and guard overlaps with one conditional `INSERT … WHERE NOT EXISTS (overlap)`. D1 serialises writes, so a single statement is atomic. Optionally add a **Durable Object per printer** as a booking lock. |
| PrintQ files | ✅ **R2** (10 GB free) | Presigned S3 `PUT` from the browser. A 50 MB limit is enforced by app policy. |
| PrintQ auth | ✅ Better Auth with Drizzle/D1 [Inference; verify adapter] | Discord OAuth plus sessions in D1. |
| Notifications | ✅ Queues (10k ops/day free) or `waitUntil` | — |
| Printer LAN integration (future) | ❌ A cloud Worker can't reach a printer on UFV's LAN | Needs Prusa Connect (cloud) or a small on-site agent pushing status to the Worker. |
| **Domain `csa.ufv.ca`** | ⚠️ **Blocker** | Workers custom domains need the DNS zone on Cloudflare, and `ufv.ca` belongs to UFV. Options: (a) UFV IT CNAMEs `csa.ufv.ca` to a **Cloudflare for SaaS** custom hostname on a CSA-owned zone (for example the historic `ufvcsa.ca`, if the CSA still owns it); (b) move to a CSA-owned domain and redirect; (c) put Cloudflare **Tunnel** in front of the UFV server (needs the same DNS cooperation). [Inference. Confirm the Cloudflare for SaaS plan requirements before choosing.] |

**Verdict:** about 95% of the code can run on Cloudflare. The real costs are **$5/mo** (realistic), a **DNS change by UFV IT**, moving Studio to sanity.studio, and an image-loader swap. A strict **$0** Cloudflare setup would mean rewriting PrintQ as a static SPA plus a small Hono Worker API. That is possible, but it's a second codebase style for volunteers.

### 3.3 The three storage plans

#### Plan L: Local DB on the UFV server (recommended for v1)

- **DB:** PostgreSQL 16 on the same host (apt or Docker), bound to localhost. Extensions: `btree_gist`, which enables the `tstzrange` **exclusion constraint** that makes double booking impossible.
- **Files:** stored on disk at `/var/lib/printq/uploads/<uuid>`, outside the web root and served only through an authorized route.
  - Uploads stream through a Route Handler. Self-hosted Next has no 4.5 MB cap.
  - **nginx default `client_max_body_size` is 1 MB**, so set `client_max_body_size 60m;` on the `/api/printq/uploads` location only.
- **Jobs:** a systemd timer (or the existing crontab) calls `/api/printq/cron` every 5 minutes with a bearer token. That handles expired holds, reminders and file purges. Nothing pauses and there are no free-tier limits.
- **Auth:** Better Auth with the Drizzle Postgres adapter and the Discord provider (or Auth.js v5). Sessions live in Postgres.
- **Backups:** nightly `pg_dump` plus a `tar` of the uploads, kept locally for 7 days. Copy them off-box to a free **R2 bucket** (10 GB) or a CSA Google Drive with `rclone`. Test a restore every term.
- **Pros:** no new vendors and no DNS work. Lowest latency to the printer LAN, so PrusaLink polling works directly. No body limits, no pausing, $0.
- **Cons:** the CSA becomes the DBA. It depends on server patching, disk space and SSH access, it's a single point of failure, and UFV IT policies may apply. These are mitigated by the runbook, backups and monitoring (Uptime Kuma or healthchecks.io free).

#### Plan C: Cloudflare (D1 + R2 + Cron Triggers)

As described in §3.2. Moving PrintQ alone to Cloudflare while the site stays on UFV is possible (`printq.<csa-domain>` or a Worker route). However, it splits auth cookies across domains, so **move everything together or not at all** [Inference].

#### Plan V: Vercel (if Cloudflare isn't possible and the UFV server must be left)

| Need | Vercel option |
|---|---|
| DB | **Neon Postgres** through the Vercel Marketplace (free: 1 GB, 100 CU-hours, scale-to-zero after 5 min). The exclusion constraint works (Postgres; `btree_gist` availability on Neon is [Unverified], check `pg_available_extensions`). Cold resume adds latency, so the Discord handler must defer (type 5) **before** querying. |
| Files | **Vercel Blob** with Client Uploads (browser → Blob; 1 GB included on Hobby). Parse server-side with ranged reads. |
| Cron | Hobby is once per day, so use a **GitHub Actions schedule** or cron-job.org every 15 min for reminders. Expired holds are handled lazily in SQL. |
| Rate limiting | Postgres counters. Upstash Redis via the Marketplace is optional. |
| Auth | Better Auth or Auth.js with Neon |
| Risks | Hobby terms (personal use only), so plan on Pro ($20/mo) if challenged. Same DNS change needed. Requires removing `sharp`-heavy images or relying on Vercel's image optimisation quotas [Unverified]. |

#### Supabase

Still viable as a DB + Auth + Storage bundle on any of the hosts above. But a 1-week pause on the free plan and a hard 50 MB file cap make it a worse fit than local Postgres (Plan L) or D1/R2 (Plan C). **Drop it from the default stack.**

### 3.4 Comparison and recommendation

| | **L: UFV server + local Postgres** ⭐ v1 | **C: Cloudflare** ⭐ long-term candidate | **V: Vercel + Neon + Blob** |
|---|---|---|---|
| Monthly cost | $0 | $0 strict / **$5 realistic** | $0 Hobby (terms risk) / $20 Pro |
| DNS change by UFV IT | No | **Yes** | **Yes** |
| Double-booking guarantee | Postgres `EXCLUDE` constraint | Guarded insert (+ Durable Object lock) | Postgres `EXCLUDE` constraint |
| 50 MB uploads | ✅ (raise nginx limit) | ✅ R2 presigned | ✅ Blob client uploads |
| Frequent jobs | ✅ systemd/cron | ✅ Cron Triggers | ⚠️ external scheduler |
| Pausing / cold start | none | none | Neon resumes after 5 min idle |
| Printer LAN integration | ✅ direct | ❌ needs agent | ❌ needs agent |
| Ops burden | **Higher** (patching, backups) | Low | Low |
| Changes to existing site | Minimal | Moderate (Studio, images, cache config) | Moderate |

**Recommendation:**

- **Build PrintQ v1 on Plan L** inside the existing app.
- Keep it **portable** so the whole site can move to **Plan C** later, if UFV IT agrees to the DNS change and someone accepts $5/mo:
  - Drizzle ORM, with a schema written once for Postgres;
  - a D1 variant only where it differs: ranges become integer pairs;
  - a `FileStore` interface with disk, R2 and Blob implementations;
  - a `/api/printq/cron` endpoint that any scheduler can call.
- **Plan V** is the fallback if the UFV server must be abandoned and Cloudflare can't be used.

---

## 4. The CSA Discord Application

### 4.1 Who owns it

- **Not determinable from code** [Verified]. The repo only reads `DISCORD_BOT_ID`, `DISCORD_BOT_TOKEN` and `DISCORD_PUBLIC_KEY` from env. There's no registration script and no OAuth invite URL in any of the 129 commits, and the public widget doesn't list bots.
- **Most likely owner:** `DevelopsS15`, who wrote all of the site's commits [Inference].
- **The endpoint is live:** `POST https://csa.ufv.ca/api/webhooks/discord/interact` returns `401` to an unsigned request [Verified].

**To find and secure it** (you or someone with server access):

1. On the UFV server, read `DISCORD_BOT_ID` from the process environment or `.env`. **Do not copy the token anywhere.**
2. Open `https://discord.com/developers/applications/<DISCORD_BOT_ID>/information`. If you can open it, you're the owner or on its Team. If not, the owner is someone else.
3. In the CSA server: **Server Settings → Integrations → Bots and Apps**. This shows the bot and who added it.
4. Ask the owner to **transfer the app to a Discord Team** (Developer Portal → Teams → create "UFV CSA" → App → Transfer to Team). Add current execs as Admins/Developers, then:
   - rotate the bot token afterwards;
   - store the token and public key in the server env and a CSA password manager;
   - document this in the runbook.

### 4.2 Integrating PrintQ into the existing app

A Discord app has **one** Interactions Endpoint URL, so PrintQ shares the existing route.

- **Dispatch:** in `app/(site)/api/webhooks/discord/interact/route.ts`, after verification (line 39):
  - forward `ApplicationCommand` with `name ∈ {"print"}`, `MessageComponent` and `ModalSubmit` whose `custom_id` starts with `printq:`, and `ApplicationCommandAutocomplete`, all to `handlePrintQInteraction(interaction)` in `app/printq/discord/handlers.ts`;
  - leave the `/sccroom` case untouched.
- **Types:** widen `VerifyDiscordRequestResult` (`app/(site)/utils.tsx` 224-229) to `APIInteraction`, and add a **5-minute timestamp window** to verification.
- **Commands:** one top-level `/print` group, for example `/print schedule`, `/print mine`, `/print cancel` (autocomplete) and `/print status`. Put them in a checked-in registration script (`scripts/discord-register-commands.ts`) that registers **the full command list**, including `/sccroom` with its existing boolean option. A bulk overwrite deletes any command not in the list, so the script **must include `/sccroom`**.
- **Responses:**
  - Read-only queries answer inline: type 4, ephemeral.
  - Anything that touches the DB or Discord REST returns type 5/6 immediately and finishes in `after()` (Next 15).
- **Admin buttons:** custom IDs `printq:approve:<bookingId>` and `printq:reject:<bookingId>` (reject opens a modal for the reason). The handler maps `interaction.member.user.id` → `profiles.role ≥ staff` and makes the state transition idempotent.
- **Membership/role check for web login:**
  - Use the **existing bot token**: `GET /guilds/{DISCORD_SERVER_ID}/members/{userId}`, then check `roles` for the verified role ID.
  - OAuth scope can then be just `identify`.
  - The web login needs the app's **OAuth2 client secret** and a redirect URI (`https://csa.ufv.ca/api/printq/auth/callback/discord`) added in the portal. **Owner access is needed.**
- **Bot permissions:** sending DMs needs no extra scope (it fails if the user has DMs off; fall back to a channel mention). Posting in the admin channel needs View Channel and Send Messages there.
- **Env additions:** `DISCORD_CLIENT_SECRET`, `PRINTQ_VERIFIED_ROLE_ID`, `PRINTQ_STAFF_ROLE_ID` (optional), `PRINTQ_ADMIN_CHANNEL_ID`, `PRINTQ_CRON_SECRET`, `PRINTQ_ENABLED`, `DATABASE_URL`, `PRINTQ_UPLOAD_DIR`, `BETTER_AUTH_SECRET`.

---

## 5. Audit: `suchmememanyskill/3d-print-queue-discord-bot`

The repo was cloned at `66c3dd6` (2024-09-11): 493-line `main.py`, `Dockerfile`, a GHCR publish workflow, and a GPL-3.0 `LICENSE`.

### 5.1 What it actually is [Verified]

- **Python discord.py gateway bot.** It holds a persistent websocket and uses the `message_content` intent (`main.py` 24-29). That conflicts with our HTTP-interactions architecture.
- It is a **personal bookmark list of model URLs** (Thingiverse, Printables, MyMiniFactory, MakerWorld; regexes at 136-141). It is not a print scheduler.
  - There are no time slots, approvals, printer state or G-code handling.
  - "Complete" just removes a URL from the list.
- **All storage lives on a third-party server** controlled by the author (`BASE_URL` default `https://vps.suchmeme.nl/print`, line 31). Each Discord user gets an "API code" that "anyone can … edit … using" (line 462). Local state is a JSON file (`data/mappings.json`, 69-73).
- Optional STL preview: it downloads an attached STL and renders 72 frames with **OpenSCAD**, then makes a GIF with **ImageMagick** (281-339). This requires the `openscad/openscad` Docker image (`Dockerfile`).

### 5.2 Quality and security issues

| Issue | Where |
|---|---|
| Hard dependency on the author's personal VPS API, so data and availability are outside CSA control | 31, 90-126, 152-194, 373-404 |
| Bearer-like "API code" that grants edit rights, shown in embed footers | 416, 436, 447, 462 |
| Logic bug: `if data['thumbnail'] is not None or data['thumbnail']['url'] …` crashes when the thumbnail is `None` | 160, 177 |
| Builds a shell command string for OpenSCAD with `create_subprocess_shell(" ".join(args))`. Low risk because filenames are UUIDs, but it is a fragile pattern. | 296-309 |
| Downloads arbitrary attachments and renders them CPU-heavily on every message, with no size limit, so it is a DoS vector | 281-312 |
| No tests, no permission checks, global mutable state, 1-hour cache | throughout |
| Last commit 2024-09-11 | git |

### 5.3 What we can use

- **Code: nothing directly.** It's a different language, a different runtime model (gateway vs HTTP), and a different problem. It's also **GPL-3.0**: copying code would oblige us to release PrintQ under GPL-3.0, and the CSA repo currently has **no LICENSE at all**.
- **Ideas worth borrowing** (reimplemented, no code copied):
  1. The `/print` **command group** with `add`, `list` and `complete` subcommands, and an autocomplete over the user's own items. This maps to `/print mine` and `/print cancel <booking>`.
  2. **Ephemeral by default, with a `show_in_channel` option** on every command (385-386, 424).
  3. Action **buttons on result embeds** ("Complete", "Download", "Add to queue"; 216-233). This maps to our approve/reject and "Cancel booking" buttons.
  4. A **persistent "Delete" button** with a fixed `custom_id` (235-242), the right pattern for admin-channel messages that must survive restarts. With HTTP interactions every button is "persistent" by design.
  5. **Model-site link recognition**, so a booking can carry an optional "source model" URL with a link-preview embed.
  6. **Previews:** we get thumbnails for free from PrusaSlicer's embedded G-code thumbnails, so OpenSCAD isn't needed.

---

## 6. Lab hours, room status and scheduling

### 6.1 What exists [Verified]

- `/sccroom open:true|false` creates a `roomStatus` Sanity document (`discordUserId`, `status`) and renames the room channel (`interact/route.ts` 109-147).
- `getLatestRoomStatus()` returns the newest one (`app/sanity/lib/query.ts` 261-280). It's shown on `/scc` (`scc/page.tsx` 26-27, 43-44, 60) and exposed at `/api/room-status`.
- It's a manual, live signal. There is no schedule. The history (117 docs in the 2025 export) could seed realistic default hours.

### 6.2 Proposed design

**Settings (admin UI, `/printing/admin/settings`):**

- `lab_hours(printer_id null, weekday, opens, closes)` with multiple windows per day, in timezone `America/Vancouver`.
- `closures(during, reason)` for holidays, exam weeks and one-off closures.
- Policy flags:
  - `start_must_be_in_lab_hours` (default **true**, since the student starts the print in person);
  - `must_finish_in_lab_hours` (default **false**, so overnight prints are allowed if the CSA accepts unattended printing; **human decision**);
  - `checkin_grace_min` (default 15);
  - `padding_pct`, `buffer_min`, `hold_ttl_min`, `max_active_per_user`.

**Slot rules (pure functions, unit-tested):**

1. Duration = `ceil(estimate × (1 + padding) + buffer)`, rounded to 15-minute slots.
2. Candidate start times are generated **only inside lab-hours windows minus closures**.
3. If `must_finish_in_lab_hours` is set, the end time must fall inside the same window.
4. Otherwise the slot may run past closing, but it blocks the printer until it ends. The next start is the next lab window after the end plus the buffer.
5. Overlaps with active bookings are rejected: by the DB `EXCLUDE` constraint (Plans L and V) or by the guarded insert (Plan C).

**Live room status:**

- When `/sccroom` is toggled, PrintQ is told via a hook from the existing handler (one `await onRoomStatusChange(isOpen)` call after line 147).
- **Room opens:** today's bookings become check-in-able, and the user is DM'd: "Lab is open, your slot starts at 14:00."
- **Room closed at slot start:** the booking is not marked no-show. It's flagged `lab_closed` and can be rebooked with priority. If the room is open and the user hasn't checked in within the grace period, it becomes `no_show`.
- The public schedule shows a "Lab open now / closed" badge using the existing status. **Stop exposing `discordUserId`** in `/api/room-status` (quick win).
- Optional nudge: if the room is closed at a time lab hours say it should be open, post an "Is the lab open?" reminder in the admin channel.

### 6.3 Printer integration roadmap (future)

| Stage | What | Works with |
|---|---|---|
| v1 | Manual: staff mark checked-in, started, finished, collected | all plans |
| v1.5 | **PrusaLink polling.** The printer's local REST API (OpenAPI spec in `prusa3d/Prusa-Link-Web`, `spec/openapi.yaml`) offers `GET /api/v1/status` and `/api/v1/job` with HTTP **Digest** auth, and camera snapshots via `/api/v1/cameras/snap`. A 30-60 s poll would auto-mark `started` and `finished`, update ETA and availability, and DM "your print is done". | **Plan L directly** if the server can reach the printer's LAN segment (**ask UFV IT**). Plans C and V need an on-site agent. |
| v2 | **Prusa Connect** (Prusa's free cloud service) for remote monitoring | all plans; no public, stable API for third parties [Unverified] |
| v2+ | Multi-printer: `printers` rows, per-printer lab hours and PrusaLink credentials | schema is ready |

MK4, MK4S, MK3.9 and CORE One run PrusaLink natively. **MK3S+ needs a Raspberry Pi add-on**. That's another reason to confirm the model.

---

## 7. Recommended Placement (Plan L, portable)

```
ufv-csa/
├─ drizzle.config.ts                               + Drizzle Kit (Postgres; D1 variant later)
├─ drizzle/                                        + generated SQL migrations (checked in)
├─ app/
│  ├─ printq/                                      + non-route code (mirrors app/sanity/lib)
│  │  ├─ env.ts                                    + zod-validated server env
│  │  ├─ db/{schema.ts,client.ts,constraints.sql}  + Drizzle schema; btree_gist + EXCLUDE in raw SQL migration
│  │  ├─ auth.ts                                   + Better Auth (Discord), requireMember/requireStaff/requireAdmin
│  │  ├─ files/{index.ts,disk.ts,r2.ts}            + FileStore interface (disk now, R2/Blob later)
│  │  ├─ discord/{handlers.ts,commands.ts,membership.ts,notify.ts}
│  │  ├─ scheduling/{hours.ts,slots.ts,duration.ts,state-machine.ts,__tests__/}
│  │  ├─ gcode/{parse-gcode.ts,parse-bgcode.ts,index.ts,__tests__/fixtures/}
│  │  ├─ printer/{prusalink.ts}                    + v1.5, behind flag
│  │  ├─ jobs.ts                                   + expireHolds, sendReminders, purgeFiles, pollPrinters
│  │  └─ components/                               + Calendar, SlotPicker, StatusBadge, UploadDropzone, LabStatusBadge
│  └─ (site)/
│     ├─ printing/                                 + inherits site layout (NavBar, Footer, dark theme)
│     │  ├─ page.tsx (+root/loading/error)         + public schedule + lab status
│     │  ├─ rules/page.tsx  ├─ new/page.tsx  ├─ me/page.tsx  ├─ login/page.tsx
│     │  └─ admin/{layout,page}.tsx + schedule/ session/ settings/ (lab hours, closures) users/ audit/
│     ├─ privacy/page.tsx                          + site-wide privacy policy (Discord requires a URL)
│     ├─ api/printq/
│     │  ├─ auth/[...all]/route.ts                 + Better Auth handler
│     │  ├─ uploads/route.ts                       + streamed upload → FileStore → parse
│     │  ├─ bookings/route.ts  bookings/[id]/route.ts  schedule/route.ts
│     │  ├─ files/[id]/route.ts                    + authorized download (owner/staff)
│     │  └─ cron/route.ts                          + bearer-protected jobs
│     └─ components/UI/{calendar,card,alert,textarea,form}.tsx  + shadcn, Tailwind-v3 versions
├─ scripts/discord-register-commands.ts            + registers /sccroom AND /print (bulk overwrite)
├─ deploy/                                         + nginx snippet (client_max_body_size), systemd timer/service, backup script
├─ .github/workflows/ci.yml                        + lint, tsc, vitest (Postgres service container for DB tests)
├─ .env.example                                    + names only
└─ docs/printq/RUNBOOK.md                          + server access, deploy, backups/restore, secrets holders, handover
```

**Existing files to touch** (described, not applied):

| File | Change |
|---|---|
| `app/(site)/api/webhooks/discord/interact/route.ts` | After line 45 (the Ping block): `if (isPrintQInteraction(interaction)) return handlePrintQInteraction(interaction);`. After line 147 (room status saved): `await onRoomStatusChange(isRoomOpen)` in a try/catch so it can't break `/sccroom`. |
| `app/(site)/utils.tsx` | Widen the interaction type to `APIInteraction` (224-229, 254-256) and add the timestamp window check in `verifyInteractionRequest` (236-259). |
| `app/(site)/components/NavBar.tsx` | After line 21, add `<InternalLinkButton href="/printing" variant="ghost">3D Printing</InternalLinkButton>`, gated by `PRINTQ_ENABLED`. |
| `app/(site)/components/NavBarSliderPanel.tsx` | After line 56, add the matching `SheetNavButton`. |
| `app/(site)/api/room-status/route.ts` | Map the result to `{status, _updatedAt}` only, dropping `discordUserId` (lines 7-10). |
| `next-sitemap.config.js` | Extend `exclude` (line 5) with `/printing/admin*`, `/printing/me`, `/printing/new`, `/printing/login`. |
| `package.json` | Deps: `drizzle-orm`, `postgres`, `better-auth`. Dev: `drizzle-kit`, `vitest`. Scripts: `test`, `typecheck`, `db:migrate`, `discord:register`. |
| `middleware.ts` | **Not needed.** Better Auth checks sessions in server components and route handlers; the admin layout gates its subtree. |
| `.gitignore` | Nothing needed: uploads live outside the repo. |
| Server (not repo) | nginx `location /api/printq/uploads { client_max_body_size 60m; proxy_request_buffering off; }`; systemd timer; Postgres install; env vars. |

**Admin access:** `profiles.role ∈ member | staff | admin`.

- Bootstrap: Discord IDs in `PRINTQ_ADMIN_DISCORD_IDS` become admins on first login.
- Optionally, holding `PRINTQ_STAFF_ROLE_ID` in Discord grants `staff`, mirroring the `DISCORD_SCC_ROOM_ROLE_ID` pattern. Each year's handover then just means moving a Discord role.

---

## 8. Risks, Gaps and Quick Wins

### 8.1 Risks

| # | Risk | Severity |
|---|---|---|
| R1 | **UFV server access and ops:** who has SSH/sudo, OS version (possibly out of support), patching, disk, no documented deploy. Plan L adds a DB to this box. | **High** |
| R2 | **Discord app ownership** unknown. Without portal access you can't add OAuth redirects, read the client secret, or rotate the token. | **High (blocker)** |
| R3 | Any host move needs a **UFV IT DNS change** for `csa.ufv.ca` | High for Plans C and V |
| R4 | Personal data in the public repo (`assets/sanity-prd.tar.gz`); `/api/room-status` exposes a Discord ID | High (privacy) |
| R5 | No privacy page (`/privacy` returns 404 live). Discord requires a privacy policy URL for apps using OAuth. | Medium |
| R6 | No tests or CI; the build needs Sanity secrets | Medium |
| R7 | Bulk command registration could delete `/sccroom` if done carelessly | Medium (handled by the script design in §4.2) |
| R8 | Cloudflare Free 10 ms CPU limit, so the "free" Cloudflare plan isn't realistic for SSR | Medium (Plan C) |
| R9 | Dependency drift (24 audit findings, `next lint` removal, postcss override not applied) | Medium |
| R10 | Zoom disabled (`layout.tsx` 31-32, WCAG 1.4.4) | Medium |
| R11 | GPL-3.0 contamination if bot code is copied | Low (don't copy) |
| R12 | Footer dynamic class bug; no Discord timestamp window check | Low |

### 8.2 Quick wins

| Task | Effort |
|---|---|
| Get server access and fill in the §2.3 checklist; write `docs/printq/RUNBOOK.md` | S |
| Get Discord portal access; transfer the app to a Team; rotate the token | S (people) |
| Drop `discordUserId` from `/api/room-status` | S |
| Remove `assets/sanity-prd.tar.gz` from the repo; keep backups private | S |
| Add `.env.example` and CI (`ci.yml`: lint + tsc) | S |
| Add a `/privacy` page | S–M |
| Re-enable zoom | S |
| `npm audit fix` (non-breaking) and regenerate the lockfile so overrides apply | S |
| Move Sanity Studio to the hosted studio (helps every plan, required for C) | M |
| Add a LICENSE (MIT, or whatever the CSA chooses) | S |

### 8.3 Privacy (not legal advice)

- **New personal data:** Discord ID, username and avatar; membership and role flags; bookings; uploaded G-code (it can include file paths or usernames, and thumbnails show the model); admin audit log.
- **Location by plan:**
  - Plan L keeps it **on UFV infrastructure in Canada**. That is good for residency, but it may bring UFV IT and privacy-office policies into scope. **Ask before launch.**
  - Plan C: D1 supports location hints and jurisdiction settings [Unverified; check D1 data location docs].
  - Plan V: Neon offers regions [Unverified for Canada].
- **Minimise:**
  - `identify` scope only;
  - no email;
  - purge G-code N days after completion;
  - retain bookings for one academic year;
  - public schedule shows no names.

### 8.4 Security essentials

- **Discord:** raw-body Ed25519 verification plus a timestamp window; staff check on every button; idempotent transitions.
- **Uploads:**
  - extension allow-list (`.gcode`, `.bgcode`);
  - magic-byte check (`GCDE` for bgcode);
  - 50 MB cap in the client, the route **and** nginx;
  - files stored outside the web root and served only via the authorized route;
  - SHA-256 hash;
  - per-user rate limits in SQL.
- **Admin:** server-side gates in `admin/layout.tsx` and in every handler.
- **Cron:** a bearer secret compared with `crypto.timingSafeEqual`.
- **DB:** listen on localhost only; least-privilege app role; `pg_dump` backups encrypted off-box.

---

## 9. Phased Plan

**Legend:** S ≤ 1 day, M 2-4 days, L 1-2 weeks. 🟢 = start now, in parallel. 🔒 = blocked on a §10 answer.

### Phase 0: Access and foundations (week 0)

| # | Task | Size | Start |
|---|---|---|---|
| 0.1 | Server access + §2.3 checklist + RUNBOOK | S | 🔒 Q1 |
| 0.2 | Discord portal access + Team transfer | S | 🔒 Q2 |
| 0.3 | Quick wins (§8.2): CI, `.env.example`, room-status ID, zoom, privacy page draft | S each | 🟢 |
| 0.4 | Slice G-code fixtures (`.gcode` and `.bgcode`) in PrusaSlicer for the printer model | S | 🟢 |

### Phase 1: Core engine (weeks 1-2)

| # | Task | Size | Start |
|---|---|---|---|
| 1.1 | Drizzle schema + migrations: profiles, printers, lab_hours, closures, settings, uploads, bookings (`EXCLUDE`), booking_events. Tested against local Postgres (Docker) and the CI service container. | M | 🟢 |
| 1.2 | Scheduling engine: lab-hours windows, closures, duration/padding, slot generation, state machine. Vitest, including DST cases. | M | 🟢 |
| 1.3 | G-code / bgcode parser + tests | M | 🟢 (after 0.4) |
| 1.4 | Better Auth with Discord + bot-token membership/role check + admin bootstrap | M | 🔒 Q2, Q3 |

### Phase 2: Web app (weeks 3-4)

| # | Task | Size | Start |
|---|---|---|---|
| 2.1 | Upload route (FileStore disk) + booking API + audit events | M | after Phase 1 |
| 2.2 | Admin: approvals queue, lab hours and closures editor, session control, users, audit log | M–L | after 2.1 |
| 2.3 | Member/public UI: schedule + lab badge, new-booking wizard, my prints, rules, privacy | L | layout 🟢; data after 2.1 |
| 2.4 | Nav link behind a flag; sitemap excludes | S | after 2.3 |

### Phase 3: Discord and automation (week 5)

| # | Task | Size | Start |
|---|---|---|---|
| 3.1 | Dispatch in the existing interact route; `/print schedule`, `/print mine`, `/print cancel`; registration script that keeps `/sccroom` | M | 🔒 Q2 |
| 3.2 | Admin-channel approve/reject buttons + reject modal; DMs with channel fallback | M | after 2.2, 3.1 |
| 3.3 | `onRoomStatusChange` hook → check-in, no-show and lab-closed logic | S | after 3.1 |
| 3.4 | `/api/printq/cron` + systemd timer + backup script + nginx snippet | S | 🔒 Q1 |

### Phase 4: Pilot and next steps (week 6+)

| # | Task | Size | Start |
|---|---|---|---|
| 4.1 | Exec pilot for 2 weeks; tune padding and hours | S | — |
| 4.2 | PrusaLink polling (v1.5) | M | 🔒 Q6, Q7 |
| 4.3 | Platform decision: stay on L, or migrate the whole site to C (Studio → sanity.studio, image loader, OpenNext, D1/R2 adapters, DNS) | L | 🔒 Q4 |
| 4.4 | Optional Microsoft Entra link | M | 🔒 UFV IT |

---

## 10. Open Questions

| # | Question | Blocker? |
|---|---|---|
| Q1 | **Who has SSH/sudo on the UFV server, and is it managed by UFV IT?** OS version? How are deploys and the existing crons run? Is installing Postgres there allowed? | **Blocker** (Plan L) |
| Q2 | **Who owns the CSA Discord application** (`DISCORD_BOT_ID`)? Can it be moved to a CSA Team? | **Blocker** (login + commands) |
| Q3 | Verified role ID, and how students get verified today | **Blocker** for 1.4 |
| Q4 | Is $5/mo for Cloudflare Workers Paid acceptable, and will UFV IT re-point `csa.ufv.ca`? Does the CSA still own `ufvcsa.ca` or another domain? | Not for v1; blocker for Plan C |
| Q5 | Printer location and default lab hours; are **unattended/overnight** prints allowed (`must_finish_in_lab_hours`)? | Blocker for slot defaults (engine is configurable) |
| Q6 | Exact printer model (MK4S/MK4/MK3.9 run PrusaLink natively; MK3S+ needs a Pi) | Not a blocker; needed for fixtures |
| Q7 | Can the UFV server reach the printer's network segment (for PrusaLink)? | Not for v1 |
| Q8 | First admins/staff; use a Discord "PrintQ Staff" role? | Not a blocker |
| Q9 | UFV privacy office or student-union requirements for a student-group system on UFV infrastructure | Blocker for launch |
| Q10 | Padding %, buffer, hold TTL, max active bookings, file retention | Not a blocker |
| Q11 | Licence for the CSA repo (currently none) | Not a blocker |

---

## 11. Appendix

### 11.1 Commands run (v2 additions; v1 commands below)

| Command | Result |
|---|---|
| `curl -sSI https://csa.ufv.ca/` | `Server: nginx/1.18.0 (Ubuntu)`, `X-Powered-By: Next.js`, `x-nextjs-prerender: 1`, `x-nextjs-cache: HIT` |
| `curl https://csa.ufv.ca/api/room-status` | 200 JSON including `discordUserId` (value not reproduced here) |
| `curl -o /dev/null -w %{http_code}` on `/privacy`, `/studio`, `/printing`, `/robots.txt`, `/sitemap.xml` | 404, 200, 404, 200, 200 |
| `curl -X POST https://csa.ufv.ca/api/webhooks/discord/interact` (unsigned) | 401 |
| RDAP `rdap.arin.net/registry/ip/198.162.116.23` | `NETBLK-UCFV1`, registrant University of the Fraser Valley |
| `curl discord.com/api/guilds/287455376994205716/widget.json` | Server name "Computing Students Association (CSA)"; no bots listed |
| `git fetch --unshallow`; history scan for secrets, registration scripts and OAuth URLs | 129 commits (128 by DevelopsS15). No secrets (lockfile integrity hashes only), no registration script, no app ID. |
| `git clone --depth 1 suchmememanyskill/3d-print-queue-discord-bot` | `66c3dd6` (2024-09-11); files: `main.py` (493 lines), `Dockerfile`, `requirements.txt`, `setup.sh`, `run.sh`, `blank.scad` (empty), `.github/workflows/publish.yml`, `LICENSE` (GPL-3.0) |
| `curl raw.githubusercontent.com/prusa3d/Prusa-Link-Web/master/spec/openapi.yaml` | Endpoints `/api/v1/status`, `/api/v1/job`, `/api/v1/files/...`, `/api/v1/cameras/snap`; `digestAuth` |

**v1 commands:** `npm ci` (✅ 30 s), `npm run lint` (✅ 4 s), `npx tsc --noEmit` (✅ 8 s), `npm run build` (❌ Sanity env, 82 s), `npm outdated`, `npm audit` (24), `npm ls postcss`, the working-tree secret scan, and the key summary of the Sanity backup (no values printed; the extracted copy was deleted).

### 11.2 Primary docs fetched 2026-10-04

- Cloudflare:
  - `developers.cloudflare.com/workers/platform/limits/` (updated 2026-09-05)
  - `/workers/platform/pricing/`
  - `/d1/platform/limits/`
  - `/d1/platform/pricing/`
  - `/r2/pricing/`
  - `/durable-objects/platform/pricing/`
  - `/queues/platform/pricing/`
  - `/workers/configuration/cron-triggers/`
- OpenNext: `opennext.js.org/cloudflare`
- Vercel:
  - `vercel.com/docs/functions/limitations`
  - `/docs/cron-jobs/usage-and-pricing`
  - `/docs/plans/hobby`
  - `/docs/vercel-blob/usage-and-pricing`
  - `/docs/storage`
- Supabase:
  - `supabase.com/pricing`
  - `/docs/guides/storage/uploads/file-limits`
- Neon: `neon.com/pricing`
- Discord: `discord.com/developers/docs/interactions/receiving-and-responding`
- Prusa:
  - `help.prusa3d.com` article "Prusa Connect and PrusaLink explained"
  - `prusa3d/Prusa-Link-Web` `spec/openapi.yaml`

### 11.3 Files consulted

The v1 list:

- **Config:** `package.json`, `tsconfig.json`, `next.config.mjs`, `next-sitemap.config.js`, `tailwind.config.ts`, `components.json`, `.eslintrc.json`, `.gitignore`, `README.md`, `sanity.config.ts`, `sanity.cli.js`.
- **Styles and layout:** `app/globals.css`, `app/(site)/layout.tsx`, `config.ts`, `utils.tsx`, `client.ts`, `serverClient.ts`.
- **Components:** NavBar, NavBarSliderPanel, NavBarAboutDropdown, Footer, LayoutWrapper, LogoWithCSAStacked, LatestAnnouncementBanner, `UI/button.tsx`.
- **API routes:** `api/utils.ts`, `api/webhooks/discord/interact/route.ts`, `api/webhooks/sanity/events/route.ts`, `api/events/reminders/route.ts`, `api/room-status/route.ts`, `api/announcements/*`.
- **Pages:** `discord/route.tsx`, `contact/page.tsx`, the studio layout and page.
- **Sanity:** `app/sanity/lib/{token,query}.ts`, `app/sanity/constants.ts`, `app/sanity/schemas/{index,executives,roomStatus}.ts`.

Added in v2: `app/(site)/scc/page.tsx` and `app/sanity/lib/query.ts` 261-280. From the bot repo: `suchmememanyskill/3d-print-queue-discord-bot/{main.py,Dockerfile,requirements.txt,setup.sh,run.sh,.github/workflows/publish.yml,LICENSE}`.
