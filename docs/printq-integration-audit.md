# PrintQ Integration Audit: UFV CSA website

- **Audit date:** 2026-10-04
- **Repo audited:** `devnull03/ufv-csa` at commit `9b4c6f4`, which is identical to `origin/master`. The upstream/canonical repo is `DevelopsS15/ufv-csa` (public, default branch `master`, homepage `https://csa.ufv.ca`), per GitHub repository metadata.
- **Scope:** Read-only. No existing file was changed. This document is the only file added.
- **Labels:** **[Verified]** = I checked it in the code or by running a command. **[Inference]** = my reasoning, not confirmed. **[Unverified]** = I could not check it from the sandbox, and the text says what is needed to check it.

---

## 1. Summary

1. The site is already a **Next.js 15.5 App Router + TypeScript + Tailwind 3 + shadcn/ui** app. It has server API routes, a working **Discord HTTP-interactions endpoint** (Ed25519-verified), a Discord bot token, and a **Sanity** headless CMS with an embedded Studio at `/studio`. Your planned PrintQ stack mostly matches what is already there.
2. **Recommendation: Option A.** Add PrintQ as routes inside the existing app: `app/(site)/printing/*`, `app/(site)/api/printq/*` and `app/printq/lib/*`, using **Supabase** for Postgres, Auth and Storage. Use a **separate Discord application ("PrintQ")** for slash commands and buttons, so the existing `/sccroom` endpoint is never touched.
3. **Why A:** it reuses the nav, layout, design tokens, the deploy pipeline and the Discord plumbing. There is no middleware or auth today, so there is nothing to conflict with. It also gives volunteers one repo and one deploy to learn. B (a separate subdomain app) doubles the accounts, secrets and DNS work for rotating volunteers, and buys very little isolation. C (a monorepo) is overkill.
4. **Biggest unknown: hosting.** There is no `vercel.json`, Dockerfile or CI config in the repo. The README is the stock create-next-app text that mentions Vercel, and `.gitignore` ignores `.vercel`. `csa.ufv.ca` resolves to `198.162.116.23`, which is not Vercel's usual apex IP. The sandbox could not reach the live site, Vercel, Supabase or Discord docs.
5. **Uploads:** send files **directly from the browser to Supabase Storage using signed upload URLs**, never through a function. Serverless request bodies are capped (Vercel: 4.5 MB). The server then parses metadata by reading only the start (bgcode) or start and end (gcode) of the stored file.
6. **Hold expiry:** handle it lazily inside the booking transaction, so correctness never depends on a cron. Run reminders and the Supabase keep-alive from a **GitHub Actions schedule in a CSA-owned repo**.
7. **Top risks:**
   - **Bus factor and ownership.** The canonical repo sits on one person's personal GitHub account, and every visible commit is by one author. Hosting, Sanity and Discord ownership are unknown.
   - **Unknown hosting/deploy** and an unknown scheduler for the existing reminders and UFV-news routes.
   - **Personal data in a public repo:** `assets/sanity-prd.tar.gz` contains Discord user IDs and names. There is also no privacy policy page.
8. **Build health:** install ✅ (30 s), lint ✅ (4 s), `tsc` ✅ (8 s). `next build` compiles but **fails at "Collecting page data" without Sanity env vars** (82 s). There are no tests and no CI.
9. Blocking questions are in §7. The top five are repeated in the chat summary.

---

## 2. Current State Inventory

### 2.1 Framework, language, tooling [Verified]

| Item | Finding | Evidence |
|---|---|---|
| Framework | Next.js **15.5.25** (App Router), React **18.3.1** | `package.json` deps (`next ^15.5.25`, `react ^18.3.1`); `npx next --version` → v15.5.25 |
| Language | TypeScript 5.9, `strict: true`, path alias `~/*` → repo root | `tsconfig.json` lines 7, 22-26 |
| Package manager | **npm**, lockfile v3 (`package-lock.json`, 828 KB) | `package-lock.json` |
| Node | No `.nvmrc`, `.node-version` or `engines` field. The sandbox used Node 22.22.0 / npm 10.9.4. | `package.json` (no `engines`) |
| Monorepo | No. Single package. | root listing |
| Build | `next build` (webpack), then `postbuild: next-sitemap` | `package.json` scripts |
| Experimental flags | `experimental.taint: true`, used to keep the Sanity write token server-only | `next.config.mjs` 13-15; `app/sanity/lib/token.ts` 9-13 |
| Overrides | `overrides` pins postcss 8.5.28 for `next` and `styled-components`, but **the lockfile does not honour it**. `npm ls postcss` reports `next/node_modules/postcss@8.4.31 invalid`. | `package.json` 11-21; `npm ls postcss` output (Appendix) |

### 2.2 Rendering model and routing [Verified]

- **Hybrid App Router.** Two route groups each have their own root layout:
  - `app/(site)/layout.tsx` is the public site. It renders `<html className="dark">` (line 41) with NavBar, Footer, an announcement banner and Umami analytics.
  - `app/(studio)/studio/[[...index]]/layout.tsx` + `page.tsx` is the embedded Sanity Studio at `/studio` (client component `NextStudio`).
- Content pages are server components that fetch from Sanity. They use `next: { tags: [...] }` cache tags (`app/sanity/lib/query.ts` lines 24-25, 79-80, 228-229, 276-277, 319-320) and on-demand `revalidateTag`/`revalidatePath` from webhooks. Dynamic segments use `generateStaticParams` (`announcements/[slug]/page.tsx:66`, `events/[slug]/page.tsx:79`, `minutes/[date]/page.tsx:58`). Page-level `revalidate` exports are all commented out.
- Per-page convention: `page.tsx` + `root.tsx` (client/presentational part) + `loading.tsx` + `error.tsx` (for example `app/(site)/events/*`).
- Pages: `/`, `/announcements`, `/announcements/[slug]`, `/events`, `/events/[slug]`, `/executives`, `/minutes`, `/minutes/[date]`, `/history`, `/scc`, `/regulations`, `/constitution`, `/contact`, `/discord` (redirect to invite, `app/(site)/discord/route.tsx`), `/studio`.
- **No `middleware.ts`** exists.

### 2.3 Hosting and deployment

| Question | Finding | Status |
|---|---|---|
| Config files | **None** of `vercel.json`, `netlify.toml`, `Dockerfile`, `fly.toml`, `wrangler.toml`, `CNAME` or `.github/` | [Verified], `find` (Appendix) |
| CI/CD | No GitHub Actions. `devnull03/ufv-csa` has 0 workflow runs. | [Verified], GitHub API |
| Platform | Probably **Vercel** (Git integration, deploying from `master`). Evidence: README "Deploy on Vercel" section (create-next-app boilerplate), `.gitignore` ignores `.vercel`, and `public/vercel.svg`. | [Inference] |
| DNS | `csa.ufv.ca` → `198.162.116.23`. That is **not** Vercel's usual apex IP (76.76.21.21). It may be a UFV-managed proxy or IP, or another host. | [Verified] lookup, [Inference] meaning |
| Live site | Sandbox egress proxy blocked `csa.ufv.ca` (HTTP 403 CONNECT), so I could not read response headers (`server`, `x-vercel-id`) or check `/studio` or `/privacy`. | [Unverified] |
| Scheduled jobs | `GET /api/events/reminders` and `GET /api/announcements/ufv-news` are cron-style endpoints protected by a static `authorization` header (`api/events/reminders/route.ts` 11-24; `api/announcements/ufv-news/route.ts` 14-27). **Nothing in the repo calls them**, so some external scheduler does (Vercel cron in the dashboard, cron-job.org, or similar). | [Verified] absence, [Inference] external |
| Build/deploy commands | `npm run build` (`next build && next-sitemap`), `npm start` | [Verified] |

**To verify hosting, I need:** read access to the hosting dashboard (Vercel team/project settings: Git branch, env vars, cron jobs, plan tier), the DNS zone for `csa.ufv.ca` (UFV IT probably owns `ufv.ca`), or just the output of `curl -sI https://csa.ufv.ca` from a normal network.

### 2.4 Domain and URL structure

- The site lives at `https://csa.ufv.ca` [Verified via repo homepage metadata]. The URL is built from the `SITE_DOMAIN` env var (`next-sitemap.config.js:2`; `api/webhooks/discord/interact/route.ts:121`; `api/webhooks/sanity/events/route.ts:44`).
- Paths are flat (`/events`, `/minutes`, …). **`/printing` fits naturally**, with `/printing/admin/*` for staff.
- A subdomain such as `print.csa.ufv.ca` would need a DNS record under `ufv.ca`, which is probably controlled by UFV IT [Inference]. That is a real cost against Option B.

### 2.5 Backend and third-party services [Verified]

| Service | Use | Files |
|---|---|---|
| **Sanity** (headless CMS, project/dataset from env) | All content: events, announcements, executives, positions, meeting minutes, room status, Discord message bookkeeping, idempotency keys | `app/sanity/schemas/*.ts`, `app/sanity/lib/query.ts`, `app/(site)/client.ts`, `app/(site)/serverClient.ts`, `sanity.config.ts` |
| Sanity webhook → Discord | `POST /api/webhooks/sanity/events`: signature-checked with `parseBody(req, secret)` (route.ts 61-75). It posts or updates Discord messages and scheduled events, then revalidates tags. | `app/(site)/api/webhooks/sanity/events/route.ts` (737 lines) |
| **Discord REST** via `@discordjs/rest` + bot token | Messages, scheduled events, temporary roles for pings | `app/(site)/api/utils.ts` 15-17, 27-205 |
| **Discord HTTP interactions** | `POST /api/webhooks/discord/interact`, one command `/sccroom` | `app/(site)/api/webhooks/discord/interact/route.ts` |
| UFV RSS → Discord | `GET /api/announcements/ufv-news` reads `blogs.ufv.ca/urgent-news/feed/` | `api/announcements/ufv-news/route.ts` 30-40 |
| Umami analytics | `cloud.umami.is` script | `app/(site)/layout.tsx` 52-56 |
| Discord widget | iframe on `/contact` | `app/(site)/contact/DiscordWidget.tsx`, `config.ts:15-16` |
| Logging | `pino` to stdout | `app/(site)/serverClient.ts` 15-17 |
| Database, ORM, form handlers | **None** besides Sanity | — |

### 2.6 Authentication and admin [Verified]

- **There is no end-user login, session or cookie handling.** A grep for cookie, session, login and auth only hits the token-protected cron routes and UI text.
- The only "admin area" is **Sanity Studio at `/studio`**, which uses Sanity's own login. Admins are **Sanity project members**, managed in the sanity.io dashboard [Inference: standard Sanity behaviour; I can't see the member list].
- Discord-side privilege: `/sccroom` checks `interaction.member.roles.includes(DISCORD_SCC_ROOM_ROLE_ID)` (`interact/route.ts` 61-63). **That is precedent for role-gated actions by Discord role.**
- The `executives` Sanity schema stores `discordId` and `isCurrent` per executive (`app/sanity/schemas/executives.ts` lines 45-47, 110-112). That is a possible source for seeding PrintQ admins.

### 2.7 Existing Discord integration [Verified]

- **Bot:** env `DISCORD_BOT_TOKEN`, `DISCORD_BOT_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_SERVER_ID`, plus channel and role IDs (see §2.10).
- **Interactions endpoint:** `verifyInteractionRequest` reads the raw body with `request.text()`, then verifies `x-signature-ed25519` and `x-signature-timestamp` with `tweetnacl` (`app/(site)/utils.tsx` 216-259). It does **not** check timestamp freshness (no replay window). That is minor, but worth doing in PrintQ.
- **Deferral pattern:** the handler POSTs a type-5 deferred callback through REST, does the work, sends the follow-up through the webhook route, and returns plain text (`interact/route.ts` 100-107, 149-163). It works, but Next 15's `after()` plus returning `{type:5}` from the HTTP response is cleaner.
- Invite link `https://discord.gg/nu4kTTR` (`config.ts:11`) and widget server ID `287455376994205716` (`config.ts:16`). These are public values, not secrets.
- No Discord **OAuth** login exists.
- **Important constraint:** a Discord application has exactly **one** Interactions Endpoint URL, and the existing app's URL is `/api/webhooks/discord/interact`. PrintQ commands must either be dispatched from that existing handler, or live in a **separate Discord application** with its own endpoint. §3 recommends the separate app.

### 2.8 Styling and design system [Verified]

**Stack:** Tailwind **3.4** (`tailwind.config.ts`), `tailwindcss-animate`, shadcn/ui ("default" style, base color slate, CSS variables, RSC). `components.json` puts shadcn components under `~/app/(site)/components` (actual folder `app/(site)/components/UI/`) and `cn` in `~/app/(site)/utils`. Radix primitives, `lucide-react` 0.349 icons, `@icons-pack/react-simple-icons` for brand icons, `sonner` toasts, `react-day-picker` 8 (shadcn calendar dependency, but no calendar component is generated yet).

**Theme:** dark mode is **forced**. `<html className="dark">` (`app/(site)/layout.tsx:41`); `next-themes` is installed but the provider is commented out (`components/LayoutWrapper.tsx` 1-10). `darkMode: ["class"]` (`tailwind.config.ts:4`).

**Font:** Inter through `next/font/google`, `latin` subset (`app/(site)/layout.tsx` 2, 13, 42).

**CSS variables** (HSL, `app/globals.css`):

| Token | Light (`:root`, lines 6-36) | Dark (`.dark`, lines 38-66), **the live theme** |
|---|---|---|
| `--background` | `0 0% 100%` | `222.2 84% 4.9%` |
| `--foreground` | `222.2 84% 4.9%` | `210 40% 98%` |
| `--card` / `--popover` | `0 0% 100%` | `222.2 84% 4.9%` |
| `--primary` | `222.2 47.4% 11.2%` | `210 40% 98%` |
| `--primary-foreground` | `210 40% 98%` | `222.2 47.4% 11.2%` |
| `--secondary` / `--muted` / `--accent` | `210 40% 96.1%` | `217.2 32.6% 17.5%` |
| `--muted-foreground` | `215.4 16.3% 46.9%` | `215 20.2% 65.1%` |
| `--destructive` | `0 84.2% 60.2%` | `0 62.8% 30.6%` |
| `--border` / `--input` | `214.3 31.8% 91.4%` | `217.2 32.6% 17.5%` |
| `--ring` | `222.2 84% 4.9%` | `212.7 26.8% 83.9%` |
| `--radius` | `0.5rem` (lg); md = radius−2px; sm = radius−4px | same |

**Brand colors** (`app/(site)/config.ts` 7-10): dark green `#36853f`, light green `#8fc63d` (logo wordmark, `LogoWithCSAStacked.tsx:17`), blended green `#52a040` (theme-color and Discord embed color `5414976`).

**Hard-coded surface palette.** These are used instead of the tokens, and **matching them matters more than the tokens**:

- Page body: `bg-slate-100 dark:bg-slate-800` (`layout.tsx:47`).
- Nav and footer: `bg-slate-200 dark:bg-slate-900`, border `border-slate-400 dark:border-slate-700` (`NavBar.tsx:8`, `Footer.tsx:21`).
- Content width: `w-11/12 md:w-10/12 lg:w-9/12 mx-auto` (`NavBar.tsx:9`).
- Popover: `bg-slate-300 dark:bg-slate-900 border-slate-400 dark:border-slate-800 border-2` (`NavBarAboutDropdown.tsx:17`).
- Buttons have **custom variants**: `default`, `information`, `danger`, `warning`, `success`, `outline`, `secondary`, `ghost`, `link`, `theme`, and sizes `default`, `xs`, `sm`, `lg`, `icon`, `xsicon`, plus `loading` and `icon` props (`components/UI/button.tsx` 8-43). PrintQ status badges can map to `success`, `warning`, `danger` and `information`.

**Layout:** `container` is centered with `2rem` padding and `2xl: 1400px` (`tailwind.config.ts` 13-19). Breakpoints are Tailwind defaults.

**Existing shadcn components:** accordion, avatar, badge, button, carousel, checkbox, command, dialog, dropdown-menu, input, label, navigation-menu, popover, progress, select, separator, sheet, skeleton, slider, sonner, table, tabs, tooltip (`app/(site)/components/UI/`). **Missing for PrintQ:** calendar, form, textarea, alert, card, toggle-group.

### 2.9 Shared layout pieces [Verified]

- **NavBar** (`components/NavBar.tsx`): desktop links at lines 11-25, plus the "About" popover (`NavBarAboutDropdown.tsx`) and a mobile sheet (`NavBarSliderPanel.tsx` 22-66). **Links are duplicated across these two files.** There is no shared nav config array.
- **Footer** (`components/Footer.tsx`). Bug: `hover:text-[${AppLogoBlendedGreen}]` (line 19) is built at runtime, so Tailwind never generates the class and the hover color does nothing.
- **LatestAnnouncementBanner** (client) fetches `/api/announcements/latest` on mount (`LatestAnnouncementBanner.tsx:13`).
- **SEO:** a `metadata` title template `%s | Computing Student Association` and a Google verification tag (`layout.tsx` 15-25). `next-sitemap` runs post-build and excludes `/studio/*` and `/api/*` (`next-sitemap.config.js:5`).
- **Analytics:** Umami (`layout.tsx` 52-56).

### 2.10 Environment variables (names only) [Verified]

Configured outside the repo: `.env*` is gitignored (`.gitignore` 39-40), and there is no `.env.example`. **No env schema or validation** exists; values use `!` non-null assertions.

`AUTH_TOKEN_EVENT_REMINDERS`, `AUTH_TOKEN_UFV_NEWS`, `DISCORD_ANNOUNCEMENT_CHANNEL_ID_CSA`, `DISCORD_ANNOUNCEMENT_CHANNEL_ID_IEEE`, `DISCORD_BOT_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_EVENT_CHANNEL_ID`, `DISCORD_EVENT_REMINDER_CHANNEL_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_SCC_ROOM_CHANNEL_ID`, `DISCORD_SCC_ROOM_ROLE_ID`, `DISCORD_SERVER_ID`, `DISCORD_SERVER_INVITE_LINK`, `DISCORD_UFV_NEWS_CHANNEL_ID`, `NEXT_PUBLIC_SANITY_DATASET`, `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_UMAMI_ANALYTICS_SITE_ID`, `SANITY_API_WRITE_TOKEN`, `SANITY_WEBHOOK_MESSAGE_SECRET`, `SITE_DOMAIN`.

`app/sanity/lib/token.ts` **throws at import** if `SANITY_API_WRITE_TOKEN` is missing (lines 5-7). The Sanity client throws without `projectId`. **Any build, including CI, therefore needs Sanity env vars.**

### 2.11 Content management [Verified schema, Inference workflow]

- Events, announcements, executives, executive positions and meeting minutes are **Sanity documents** edited in `/studio` by Sanity project members (presumably the executives).
- Publishing an event or announcement fires the Sanity webhook, which posts to Discord.
- Bookkeeping documents (`roomStatus`, `discordMessages`, `discordEvents`, `ufvUrgentNews`, `idempotencyKey`) are written by the server and marked "DO NOT CREATE ITEMS HERE" (for example `schemas/roomStatus.ts` 4-5).
- Static pages (history, regulations, constitution, scc) are hard-coded TSX.

### 2.12 Quality tooling [Verified]

- **Tests:** none (no test runner, no `*.test.*`).
- **Lint:** `next lint` with `next/core-web-vitals` (`.eslintrc.json`). It prints a deprecation notice: `next lint` is removed in Next 16.
- **Formatting:** no Prettier config. Tabs and spaces are mixed (for example `utils.tsx` uses tabs in places).
- **Pre-commit hooks:** none. **CI:** none.
- **Staging/preview:** unknown. Vercel would provide per-branch previews automatically if it is the host [Inference].

### 2.13 Dependency health [Verified, from `npm outdated` / `npm audit` on 2026-10-04]

- **`npm audit`: 24 vulnerabilities (1 low, 3 moderate, 20 high).**
  - Most are in **Sanity Studio and CLI tooling** (`sanity`, `@sanity/cli`, `@sanity/codegen`, `micromatch`, `braces`, `adm-zip`, `chokidar`) and **dev tooling** (`eslint-config-next`, `next-sitemap` via `fast-glob`). They mostly affect build and dev time, not the served site [Inference].
  - Runtime-relevant items:
    - `next` (moderate). The fix is Next 16, a major upgrade.
    - `postcss` (high). It is bundled inside `next` at 8.4.31 because the `overrides` are not applied in the lockfile.
    - `next-sanity` (high). Fixed in 11.6.13, a patch release.
    - `dompurify` (low).
    - `markdown-it` (moderate).
  - `tailwindcss` and `tailwindcss-animate` are flagged with no fix available at the major they are on.
- **Majors behind:**

  | Package | Current | Latest |
  |---|---|---|
  | next | 15.5 | 16.3 |
  | react / react-dom | 18 | 19 |
  | tailwindcss | 3.4 | 4.3 |
  | sanity | 4 | 6 |
  | next-sanity | 11 | 13 |
  | zod | 3 | 4 |
  | lucide-react | 0.349 | 1.51 |
  | cmdk | 0.2 | 1.1 |
  | react-day-picker | 8 | 10 |
  | eslint | 9 | 10 |
  | typescript | 5.9 | 7.0 |
  | discord-api-types | 0.37 | 0.38 |
  | pino | 8 | 10 |
  | uuid | 11 | 14 |

- **Deprecated or unmaintained:** `next lint` (removed in Next 16), `tsconfck@3.1.6` (npm warns "unmaintained"), and `@sanity/block-content-to-markdown` (legacy package). `ws`, `braces` and `micromatch` are listed as direct deps but look like leftovers from vulnerability pinning [Inference].
- **Implications for PrintQ:**
  - Current shadcn CLI templates target Tailwind v4 / React 19. Generate components with the **Tailwind v3-compatible** shadcn version, or copy them by hand into `components/UI/` the way the existing ones were.
  - `@supabase/ssr` works with Next 15 (async `cookies()`).
  - Building PrintQ on **zod 3** (already installed) is fine.

### 2.14 Local run results [Verified]

| Step | Result | Time |
|---|---|---|
| `npm ci` | ✅ 1,543 packages; warning: `tsconfck` unmaintained | 30 s |
| `npm run lint` | ✅ "No ESLint warnings or errors" (plus a `next lint` deprecation notice) | 4 s |
| `npx tsc --noEmit` | ✅ no errors | 8 s |
| tests | n/a. No test script exists. | — |
| `npm run build` (no env) | ❌ "Compiled successfully in 70s" and lint/types passed, then **failed at "Collecting page data"**: `Configuration must contain projectId` while loading `/api/announcements/latest`. The build needs `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET` and `SANITY_API_WRITE_TOKEN`. I did not invent values for them. | 82 s |

---

## 3. Fit Analysis

### 3.1 Can the (likely) host do what PrintQ needs?

**Note on sources:** official docs for Vercel, Supabase and Discord were **blocked by the sandbox egress proxy**. The limits below come from web search snippets plus long-standing published limits. **Re-check them on the live docs pages before committing to a design.**

| Need | Vercel Hobby (assumed host) | Verdict |
|---|---|---|
| Server routes | Yes. The site already runs dynamic routes (`export const dynamic = "force-dynamic"` in 4 route files). | ✅ |
| Discord interactions (raw body, Ed25519, 3 s ack, 15-min follow-ups) | Already working in production for `/sccroom`. Node functions run up to 300 s on Hobby (search result), so `after()` follow-ups fit easily. Cold starts are typically well under 3 s [Inference]. Ack immediately with type 5/6 and do the work in `after()`. | ✅ |
| Upload ~50 MB | **Vercel function request bodies are capped at 4.5 MB** (published limit; I couldn't fetch the page). | ❌ through the server → ✅ direct to Supabase Storage with signed upload URLs |
| Parse large G-code | Up to 300 s and 2 GB on Hobby (search result). Parsing only needs the **head of `.bgcode`** (metadata and thumbnail blocks come before G-code blocks) or the **head (thumbnails) and tail (`; key = value` config comments) of `.gcode`**, so Range-reads of about 1 MB + 64 KB from Storage are enough. | ✅ |
| Scheduled jobs | Search results say Hobby cron is limited to **once per day** (the job count reported varies, so check the docs). Not good enough for 15-minute reminders. | ⚠️ → use **GitHub Actions `schedule`** (minimum 5-minute interval, best-effort timing) to call a bearer-protected `/api/printq/cron` |
| Commercial-use terms | Vercel Hobby is for personal, non-commercial use. A free, no-payment student association tool is *probably* fine, but the site is already on whatever plan it is on. | ⚠️ question for owner |
| Supabase Auth cookies/middleware | No `middleware.ts` and no existing cookies, so nothing conflicts. Scope the new middleware matcher to `/printing/:path*` and `/api/printq/:path*` so the rest of the site keeps its static/ISR behaviour. | ✅ |

**Supabase free tier** (search results; verify on supabase.com/pricing):

- 500 MB database, 1 GB storage, 5 GB egress, 50k MAU, 2 active projects.
- **Paused after 1 week of inactivity.**
- Per-file upload limit of **50 MB** on Free (long-standing published limit, not confirmed this session).
- **Mitigations:**
  - (a) The GitHub Actions cron hits an endpoint that runs a real DB query at least daily, which doubles as a keep-alive.
  - (b) Delete G-code files N days after `collected` or `rejected`, and keep only the parsed metadata and thumbnail.
  - (c) Cap uploads at 50 MB in both the client and the Storage bucket policy.
- **GitHub Actions caveat (from memory, verify):** scheduled workflows in **public** repos are auto-disabled after 60 days without repository activity. During summer that would stop reminders and the keep-alive. Mitigations: a monthly workflow that commits a heartbeat, or a private ops repo, or Supabase `pg_cron` for DB-only tasks such as purging old files' rows (it can't keep the project from pausing [Inference]).

**Uploads: recommended flow**

1. The client requests `POST /api/printq/uploads`. The server checks the session and membership, then calls `createSignedUploadUrl(path)` for `gcode/{userId}/{uuid}.bgcode`.
2. The client PUTs the file directly to Storage.
3. The client calls `POST /api/printq/uploads/{id}/parse`. The server Range-reads the head and tail with the service role, parses them, validates the printer model against `printers.model`, and stores the metadata and thumbnail PNG.
4. Optionally parse in the browser first, for instant preview. **The server result is authoritative.**

**Discord membership and role check:**

- Supabase stores the Discord `provider_token` only at sign-in and does not refresh it [Inference from Supabase docs as I remember them; verify]. So a `guilds.members.read` check can only run inside the OAuth callback.
- **Simpler and re-checkable alternative:** after login, the server calls `GET /guilds/{DISCORD_SERVER_ID}/members/{discordUserId}` with the **PrintQ bot token**. That endpoint should not need the privileged Server Members intent (verify). The server caches `is_member`, `has_verified_role` and `checked_at` in `profiles`, and re-checks on booking or every 24 h.
- This keeps OAuth scopes to `identify` only, which is better for privacy. You can still request `guilds.members.read` if you prefer not to rely on the bot.

### 3.2 Option comparison

| | **A. Routes inside existing app** ⭐ | **B. Separate Next.js app on subdomain** | **C. Monorepo split** | **D. Hybrid: A + separate Discord app + GH Actions cron** |
|---|---|---|---|---|
| Changes to existing repo | New dirs (`app/(site)/printing`, `app/(site)/api/printq`, `app/printq`, `supabase/`, `.github/workflows/`), a new `middleware.ts`, and small edits to NavBar ×2, `next.config.mjs`, `package.json`, `next-sitemap.config.js` and README | One nav link (an external URL) | Move the whole site into `apps/site`, so every path, config and the deploy root changes | Same as A. **This is how A should be done.** |
| Deploy impact | Same project. Each PrintQ deploy redeploys the site, and a bad PrintQ build blocks site deploys. | New project and domain. Needs a DNS record under `ufv.ca` (UFV IT). | Host root-dir and build changes, so high risk of a broken deploy | Same as A |
| Auth/session | Supabase cookies on `csa.ufv.ca`, scoped by middleware matcher | Isolated cookies on the subdomain | Same as A or B | Same as A |
| Design consistency | Automatic: same layout, NavBar, tokens and `UI/` components | Copy tokens and components, which drift over time | Shared `packages/ui` (best on paper, most work) | Automatic |
| Risk to current site | Low to medium. Mitigate with a scoped matcher, no edits to existing routes, and a feature flag env. | Lowest | Highest | Low |
| Free-tier fit | One hosting project. Uploads bypass functions. GH Actions cron. | Two hosting projects (fine on free tiers, but double the dashboards) | Same as A | Best |
| Volunteer maintainability | One repo, one deploy, one set of conventions | Two repos, two deploys, two env sets, extra DNS. **Worst for rotation.** | Tooling complexity (workspaces) volunteers rarely know | Best |
| Discord | Must share or dispatch the existing endpoint, or use a new app | Natural fit for a separate Discord app | — | Separate "PrintQ" Discord application → own endpoint `/api/printq/discord/interactions`, own token. **Zero edits to `/sccroom`.** |

**Recommendation: A, executed as D.** One Next.js app gets new `/printing` routes, Supabase is added for PrintQ data only (Sanity stays the CMS), a **separate Discord application** handles PrintQ, and a **GitHub Actions** workflow handles reminders and keep-alive.

**Fallback (assumption to verify):** if it turns out the host cannot run server code, or the upstream maintainer won't accept PrintQ in the main repo, Option B with copied tokens is the fallback. The cost is a subdomain DNS request to UFV IT, or hosting on `*.vercel.app` and linking from the nav.

---

## 4. Recommended Placement

### 4.1 Tree (new paths marked `+`; nothing existing is moved)

```
ufv-csa/
├─ middleware.ts                                   + Supabase session refresh; matcher: /printing/:path*, /api/printq/:path*
├─ supabase/                                       + Supabase CLI project (config.toml, seed.sql)
│  ├─ config.toml
│  ├─ seed.sql                                     + dev printer, lab hours, settings; admin Discord IDs come from env, not git
│  └─ migrations/
│     ├─ 0001_extensions.sql                       + btree_gist
│     ├─ 0002_core.sql                             + profiles, printers, settings, lab_hours, closures
│     ├─ 0003_bookings.sql                         + uploads, bookings (tstzrange + EXCLUDE), booking_events (audit log)
│     ├─ 0004_rls.sql                              + RLS policies
│     └─ 0005_functions.sql                        + request_booking(), expire_holds(), transition_booking()
├─ app/
│  ├─ printq/                                      + non-route code (mirrors app/sanity/lib convention)
│  │  ├─ env.ts                                    + zod-validated env (server-only)
│  │  ├─ constants.ts                              + states, padding defaults, MIME/size limits
│  │  ├─ types.ts                                  + DB row types (supabase gen types output)
│  │  ├─ lib/
│  │  │  ├─ supabase/{server.ts,browser.ts,admin.ts}  + @supabase/ssr clients; admin = service role, server-only
│  │  │  ├─ auth.ts                                + requireMember(), requireAdmin()
│  │  │  ├─ discord/
│  │  │  │  ├─ verify.ts                           + Ed25519 + timestamp window (may reuse verifyWithNacl idea)
│  │  │  │  ├─ membership.ts                       + GET guild member via bot token, role check, cache
│  │  │  │  ├─ commands.ts                         + /schedule, /mine definitions + register script
│  │  │  │  ├─ handlers.ts                         + command + button (approve/reject) handlers
│  │  │  │  └─ notify.ts                           + DMs, admin-channel messages
│  │  │  ├─ scheduling/
│  │  │  │  ├─ slots.ts                            + pure: lab hours × closures × existing bookings → free slots
│  │  │  │  ├─ duration.ts                         + estimate × padding + buffer, rounding
│  │  │  │  ├─ state-machine.ts                    + pending→approved→checked_in→started→finished→collected | rejected | expired | no_show | cancelled
│  │  │  │  └─ __tests__/*.test.ts                 + vitest, America/Vancouver DST edge cases
│  │  │  └─ gcode/
│  │  │     ├─ parse-gcode.ts                      + ASCII: thumbnails (head), "; estimated printing time", "; filament used [g]", "; printer_model" (tail)
│  │  │     ├─ parse-bgcode.ts                     + binary header + metadata/thumbnail blocks (deflate via node:zlib)
│  │  │     ├─ index.ts                            + detect type, Range-read from Storage, return {seconds, grams, model, bbox, thumbnail}
│  │  │     └─ __tests__/{fixtures/*.gcode,*.bgcode, *.test.ts}
│  │  └─ components/                               + PrintQ-specific UI (Calendar, SlotPicker, StatusBadge, UploadDropzone, BookingCard)
│  ├─ (site)/
│  │  ├─ printing/                                 + inherits (site)/layout.tsx → NavBar/Footer/theme
│  │  │  ├─ page.tsx                               + public read-only schedule (+ loading.tsx, error.tsx, root.tsx per convention)
│  │  │  ├─ rules/page.tsx                         + rules + privacy notice
│  │  │  ├─ login/page.tsx                         + "Sign in with Discord"
│  │  │  ├─ auth/callback/route.ts                 + exchangeCodeForSession → membership check
│  │  │  ├─ new/page.tsx                           + upload → parse → pick slot → submit
│  │  │  ├─ me/page.tsx                            + my prints
│  │  │  └─ admin/
│  │  │     ├─ layout.tsx                          + requireAdmin() gate
│  │  │     ├─ page.tsx                            + approvals queue
│  │  │     ├─ schedule/page.tsx                   + schedule manager, closures
│  │  │     ├─ session/page.tsx                    + today: check-in / started / finished / no-show / collected
│  │  │     ├─ settings/page.tsx                   + lab hours, padding, buffer, hold TTL, printers
│  │  │     ├─ users/page.tsx                      + roles, bans
│  │  │     └─ audit/page.tsx                      + booking_events log
│  │  ├─ api/printq/
│  │  │  ├─ uploads/route.ts                       + POST → signed upload URL
│  │  │  ├─ uploads/[id]/parse/route.ts            + POST → parse + store metadata
│  │  │  ├─ bookings/route.ts                      + POST create (calls request_booking RPC), GET mine
│  │  │  ├─ bookings/[id]/route.ts                 + PATCH transitions (admin) / cancel (owner)
│  │  │  ├─ schedule/route.ts                      + GET public availability (cached, no PII)
│  │  │  ├─ discord/interactions/route.ts          + PrintQ Discord app endpoint
│  │  │  └─ cron/route.ts                          + bearer-protected: expire holds, reminders, purge old files, keep-alive
│  │  └─ components/UI/{calendar,card,alert,textarea,form}.tsx   + shadcn (Tailwind-v3 versions)
├─ scripts/printq-register-commands.ts             + one-off Discord command registration
├─ .github/workflows/
│  ├─ ci.yml                                       + lint, tsc, vitest (no build, avoids Sanity secrets), on PR
│  └─ printq-cron.yml                              + schedule: */15 during lab days → curl /api/printq/cron
└─ docs/printq/README.md                           + runbook: accounts, secrets, handover checklist
```

### 4.2 Data model sketch (Postgres)

- `profiles(id uuid pk → auth.users, discord_id text unique, display_name, role text check in ('member','staff','admin') default 'member', is_member bool, has_verified_role bool, checked_at, banned_until)`
- `printers(id, name, model text, active bool, bed_x, bed_y, bed_z)`
- `settings(key pk, value jsonb)`: padding %, buffer minutes, hold TTL, max active bookings per user, file retention days
- `lab_hours(printer_id, weekday, opens time, closes time)`, `closures(printer_id null, during tstzrange, reason)`
- `uploads(id, owner, storage_path, kind, size_bytes, sha256, parsed jsonb, print_seconds, filament_g, printer_model, bbox jsonb, thumbnail_path, created_at, purged_at)`
- `bookings(id, printer_id, owner, upload_id, slot tstzrange, status, hold_expires_at, approved_by, ...)` with
  `EXCLUDE USING gist (printer_id WITH =, slot WITH &&) WHERE (status IN ('pending','approved','checked_in','started'))`
- `booking_events(id, booking_id, actor, from_status, to_status, note, at)`: append-only audit log

**Hold expiry without cron:** `request_booking()` (SECURITY DEFINER) first runs `UPDATE bookings SET status='expired' WHERE status='pending' AND hold_expires_at < now() AND printer_id = $1`, then inserts. The exclusion constraint guarantees no double booking. The cron only does the same thing proactively and sends "your hold expired" DMs.

### 4.3 Exact existing files to touch (described, **not applied**)

| File | Minimal change |
|---|---|
| `app/(site)/components/NavBar.tsx` | After line 21 (the Events link), add `<InternalLinkButton href="/printing" variant="ghost">3D Printing</InternalLinkButton>`. |
| `app/(site)/components/NavBarSliderPanel.tsx` | After line 56, add a matching `<SheetNavButton href="/printing" onClick={onClick}>3D Printing</SheetNavButton>`. |
| `middleware.ts` (**new**, root) | `updateSession()` from `@supabase/ssr`; `export const config = { matcher: ['/printing/:path*', '/api/printq/:path*'] }`. Explicitly **exclude** `/api/printq/discord/interactions` and `/api/printq/cron`, because the interactions route must receive the raw body untouched and needs no cookies. |
| `next.config.mjs` | Add `{ protocol: "https", hostname: "<project-ref>.supabase.co" }` to `images.remotePatterns` (lines 6-11) for thumbnails, or render thumbnails with plain `<img>` from signed URLs and skip this. |
| `next-sitemap.config.js` | Extend `exclude` (line 5) with `"/printing/admin*", "/printing/me", "/printing/new", "/printing/login", "/printing/auth/*"`. |
| `package.json` | Deps: `@supabase/supabase-js`, `@supabase/ssr`. Dev: `vitest`, `supabase` (CLI). Scripts: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`, `"printq:commands": "tsx scripts/printq-register-commands.ts"` (or `node --experimental-strip-types`). |
| `.gitignore` | Add `supabase/.temp/` and `supabase/.branches/`. |
| `README.md` | Add a "PrintQ" section: env var names, `supabase start`/`db push`, command registration, link to the `docs/printq/README.md` runbook. |
| `app/(site)/api/webhooks/discord/interact/route.ts` | **No change** under the recommendation (separate Discord app). If the CSA insists on one bot, add `case "schedule": case "mine": return printqHandle(interaction)` before `default:` (line 181), and widen the interaction types to include `MessageComponent`. |
| Host env settings (dashboard, not repo) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key), `SUPABASE_SERVICE_ROLE_KEY`, `PRINTQ_DISCORD_APP_ID`, `PRINTQ_DISCORD_PUBLIC_KEY`, `PRINTQ_DISCORD_BOT_TOKEN`, `PRINTQ_DISCORD_GUILD_ID` (can reuse `DISCORD_SERVER_ID`), `PRINTQ_VERIFIED_ROLE_ID`, `PRINTQ_ADMIN_CHANNEL_ID`, `PRINTQ_ADMIN_DISCORD_IDS` (bootstrap only), `PRINTQ_CRON_SECRET`, `PRINTQ_ENABLED` (feature flag). GitHub repo secrets: `PRINTQ_CRON_SECRET`, `PRINTQ_CRON_URL`. |

### 4.4 Nav, look and admin access

- **Nav:** add a top-level "3D Printing" link (desktop + mobile). Put it behind `PRINTQ_ENABLED` so it can ship dark.
  - **Quick win:** pull the duplicated link lists in `NavBar.tsx` and `NavBarSliderPanel.tsx` into one `navItems` array. That is a separate, optional refactor, not part of PrintQ.
- **Look:** PrintQ pages live under `app/(site)/`, so they inherit the root layout, Inter font, forced dark theme, NavBar and Footer automatically. Reuse:
  - `components/UI/*` and the custom `Button` variants;
  - the surface classes `bg-slate-200 dark:bg-slate-900` + `border-slate-400 dark:border-slate-700` for cards/panels;
  - the width wrapper `w-11/12 md:w-10/12 lg:w-9/12 mx-auto`;
  - brand green `#52a040` (`AppLogoBlendedGreen`) for "available" slots, and `#36853f` / `#8fc63d` for accents.

  Status colors map to the existing `success` / `warning` / `danger` / `information` button variants.
- **Admin access:**
  - `profiles.role` ∈ `member | staff | admin`, enforced in `app/(site)/printing/admin/layout.tsx` (server-side `requireAdmin()`), in every `/api/printq/*` mutation, **and** in RLS.
  - **Bootstrap:** on first login, if the user's Discord ID is in `PRINTQ_ADMIN_DISCORD_IDS`, set `role='admin'`. After that, admins promote others in `/printing/admin/users`.
  - **Optional:** a Discord "PrintQ Staff" role ID that grants `staff` automatically, mirroring the existing `DISCORD_SCC_ROOM_ROLE_ID` pattern. Each year's handover then becomes "move the Discord role", which suits rotating volunteers.
  - Avoid coupling to the Sanity `executives.discordId` field: it is in another system, and not every exec should approve prints.
  - Discord button approvals must map the clicking user's Discord ID to a `profiles` row with role ≥ staff before acting.

---

## 5. Risks, Gaps, and Quick Wins

### 5.1 Things that make this harder

| # | Issue | Evidence | Severity |
|---|---|---|---|
| R1 | **Bus factor / ownership.** The canonical repo is on a personal account (`DevelopsS15/ufv-csa`), and all 53 commits in the (shallow) history are by `DevelopsS15`. Hosting, Sanity project, Discord app and domain ownership are unknown. | GitHub metadata; `git log` | **High** |
| R2 | **Hosting and cron unknown.** No deploy config is in the repo, and the existing cron routes are called by an unknown external scheduler. The DNS IP is not obviously Vercel. | §2.3 | **High** (blocker for deploy design) |
| R3 | **Personal data committed to a public repo.** `assets/sanity-prd.tar.gz` (50 MB Sanity export, 2025-05-22) contains `roomStatus.discordUserId` (117 docs), `executives` with `fullName`/`discordId`/`discordUsername` (34), and meeting-minutes attendance. **No credentials or tokens were found in it** (scan in Appendix). | `tar -tzf` + key summary | **High** (privacy) |
| R4 | No privacy policy page exists (no `/privacy` route under `app/`). PrintQ adds new personal data. | route list | Medium |
| R5 | Build needs Sanity secrets, there is no CI, and there are no tests. A PrintQ PR can't be safely validated without the secrets. | §2.14 | Medium |
| R6 | Dependency drift: 24 audit findings, `next lint` removal in Next 16, postcss override not applied in lockfile | §2.13 | Medium |
| R7 | Supabase pause and GitHub Actions 60-day schedule auto-disable during summer | §3.1 | Medium |
| R8 | Accessibility: `maximumScale: 1, userScalable: false` blocks pinch-zoom (WCAG 1.4.4) | `app/(site)/layout.tsx` 31-32 | Medium (a booking calendar on mobile makes it worse) |
| R9 | Footer hover class never generated (dynamic Tailwind class) | `components/Footer.tsx:19` | Low |
| R10 | Discord verify has no timestamp freshness check | `app/(site)/utils.tsx` 236-259 | Low |
| R11 | No `.env.example` and no env validation; `!` assertions hide missing config until runtime | §2.10 | Low |
| R12 | Single Discord interactions URL per app. Sharing the existing bot would couple PrintQ to `/sccroom`. | §2.7 | Low (avoided by a separate app) |

### 5.2 Prerequisite quick wins (do before or alongside Phase 1)

| Task | Effort |
|---|---|
| Move ownership: transfer the repo to a **CSA GitHub organization** (or add CSA org owners), and record who owns hosting, Sanity, Discord apps and the domain | S (people), blocker |
| Remove `assets/sanity-prd.tar.gz` from the public repo and store backups privately (note: it stays in git history unless history is rewritten, which is the upstream owner's decision) | S |
| Add `.env.example` with the variable **names** from §2.10 + PrintQ ones | S |
| Add `ci.yml`: `npm ci && npm run lint && npx tsc --noEmit` (+ `vitest` once added). This needs no secrets. | S |
| Add `privacy` page (site-wide) with a PrintQ section | S–M (content needs exec sign-off) |
| Remove `userScalable: false` / `maximumScale: 1` | S |
| Run `npm audit fix` (non-breaking: `next-sanity` 11.6.13, dompurify, markdown-it); regenerate the lockfile so overrides apply | S |
| Migrate `next lint` → ESLint CLI (`npx @next/codemod next-lint-to-eslint-cli .`) before any Next 16 bump | S |
| Pin Node version (`"engines": {"node": ">=20"}` or `.nvmrc`) to match the host | S |
| Next 16 / React 19 / Tailwind 4 upgrades | L. **Not** a prerequisite; do it after PrintQ v1. |

### 5.3 Privacy and compliance notes (not legal advice)

- **New personal data:**
  - Discord user ID, username, display name and avatar URL;
  - membership and role flags;
  - booking history and timestamps;
  - uploaded G-code (it can embed the slicer username or file paths in comments, and thumbnails can show the model);
  - an optional university email or Entra ID later;
  - an admin action audit log.
- **Storage location:** Supabase lets you pick a region at project creation. Choosing **Canada (Central)** if offered keeps data in Canada. *Verify region availability on the free tier.*
- **BC FIPPA:** BC FIPPA applies to the university. Whether it applies to a student association's own system is a question for the student union or UFV privacy office. **Flag it, and ask before launch**, especially if the system ever runs on UFV infrastructure or uses Entra.
- **Data minimisation:**
  - Request only the `identify` scope (do the membership check with the bot token).
  - Don't store email.
  - Purge G-code files N days after completion and keep only the metadata.
  - Set a retention period for bookings and the audit log (for example, one academic year).
- **Privacy page:** there isn't one, so add one. It should say what data is collected, why, where it is stored (region), how long it is kept, who can see it (admins), and how to request deletion.
- **Discord Developer Policy:** apps that use Discord data need a privacy policy URL in the developer portal. That is another reason to write the page.

### 5.4 Security basics for PrintQ

- **Discord:**
  - Verify Ed25519 on the **raw** body (`await req.text()` before any JSON parse) and reject timestamps older than about 5 minutes.
  - Ack within 3 s (type 5 or 6) and finish in `after()`.
  - For buttons, re-check that the actor's `profiles.role` is at least staff, and that the booking is still `pending` (idempotent transition).
- **RLS:**
  - Enable it on every table.
  - `bookings`: owners select their own rows; the public schedule comes from a **view or RPC that returns only slot and status, with no PII**; only `staff`/`admin` can update status.
  - `uploads` and the Storage bucket: private; the path prefix must equal `auth.uid()`; reads only by the owner or staff through signed URLs.
  - The service-role key is used only in `app/printq/lib/supabase/admin.ts` (imports `server-only`; apply `experimental_taintUniqueValue` like `app/sanity/lib/token.ts`).
- **Uploads:**
  - Allow-list the extensions `.gcode` and `.bgcode`.
  - Check magic bytes: `GCDE` for bgcode, ASCII for gcode.
  - Enforce a 50 MB max in the client, the API check **and** the Storage bucket `file_size_limit`.
  - Enforce one active upload per pending booking.
  - Compute a SHA-256 for deduplication.
  - Never execute or serve G-code publicly.
- **Rate limiting (free):** use a per-user count in Postgres (for example, max N uploads/hour and M active bookings, enforced in `request_booking()`), not an external service.
- **Admin routes:** the server-side gate in `admin/layout.tsx` **plus** a check in every route handler. Never rely on hiding UI.
- **Cron endpoint:** `Authorization: Bearer ${PRINTQ_CRON_SECRET}`, compared in constant time. This follows the existing `AUTH_TOKEN_*` pattern, but with timing-safe comparison.

---

## 6. Phased Plan

**Legend:** S ≈ ≤1 day, M ≈ 2-4 days, L ≈ 1-2 weeks of volunteer time. 🟢 = can start **now** in parallel; 🔒 = blocked on an open question (§7).

### Phase 0: Ownership and prerequisites (week 0)

| # | Task | Size | Start |
|---|---|---|---|
| 0.1 | Answer the §7 blockers: hosting, repo ownership, Discord IDs, approver | S | 🔒 |
| 0.2 | Create CSA-owned accounts: GitHub org, Supabase org/project (Canada region if possible), "PrintQ" Discord application | S | 🔒 (needs owner) |
| 0.3 | Quick wins: `.env.example`, `ci.yml` (lint + tsc), viewport zoom fix, `npm audit fix`, remove the Sanity backup | S each | 🟢 (PRs to upstream) |
| 0.4 | Collect G-code fixtures: slice 5-10 models in PrusaSlicer for the candidate MK model(s), as `.gcode` **and** `.bgcode` | S | 🟢 |

### Phase 1: Core engine, no UI (weeks 1-2)

| # | Task | Size | Start |
|---|---|---|---|
| 1.1 | Supabase schema + settings migrations (§4.2), exclusion constraint, `request_booking()`, `expire_holds()`, RLS. Test locally with `supabase start` (Docker). | M | 🟢 (local only; no account needed) |
| 1.2 | Scheduling engine (`slots.ts`, `duration.ts`, `state-machine.ts`) as pure functions + vitest (DST, closures, overlaps, buffer at the end of day) | M | 🟢 |
| 1.3 | Discord login (Supabase Auth Discord provider) + callback + bot-token membership/role check + profile upsert + admin bootstrap | M | 🔒 guild ID, verified role ID, Supabase project |
| 1.4 | G-code parser (`.gcode` head/tail, `.bgcode` blocks) + fixtures + tests | M | 🟢 (after 0.4) |

### Phase 2: Booking flow and admin (weeks 3-4)

| # | Task | Size | Start |
|---|---|---|---|
| 2.1 | Booking API: signed upload, parse, create (RPC), cancel, transitions, audit events | M | after 1.1-1.4 |
| 2.2 | Admin approvals: queue, approve/reject with reason, hold handling | M | after 2.1 |
| 2.3 | UI: public schedule, `/printing/new` wizard, `/printing/me`, rules/privacy, and the admin pages (schedule, session, settings, users, audit) using existing `UI/` components and tokens | L | layout work 🟢; data wiring after 2.1 |
| 2.4 | Nav link behind `PRINTQ_ENABLED`; `middleware.ts` scoped matcher; `next.config`/sitemap edits | S | after 2.3 |

### Phase 3: Discord bot and automation (week 5)

| # | Task | Size | Start |
|---|---|---|---|
| 3.1 | PrintQ Discord app: endpoint, `/schedule`, `/mine`, command registration script | M | app setup 🟢; code after 2.1 |
| 3.2 | Admin-channel approve/reject buttons + DMs/channel notifications | M | after 2.2, 3.1; 🔒 admin channel ID |
| 3.3 | `/api/printq/cron` (expire holds, reminders, purge files, keep-alive) + `printq-cron.yml` | S | after 2.1 |
| 3.4 | Runbook `docs/printq/README.md`: accounts, secret holders, yearly handover checklist, restore steps | S | 🟢 |

### Phase 4: Pilot and later (week 6+)

| # | Task | Size | Start |
|---|---|---|---|
| 4.1 | Pilot with execs for 2 weeks; tune padding and buffer | S | after 3.x |
| 4.2 | Optional Microsoft Entra link (Supabase Azure provider) | M | 🔒 UFV IT approval |
| 4.3 | Multi-printer UI (schema already supports `printer_id`) | M | later |

The order you proposed is kept, apart from three changes:

- Discord **app setup** and **fixture collection** move earlier because they take no code.
- Hold expiry is designed into the schema (lazy) in Phase 1, rather than left for the cron phase.
- Privacy and rules pages are pulled into Phase 2, because Discord requires a privacy policy URL for the app.

---

## 7. Open Questions (human answers needed)

| # | Question | Blocker? |
|---|---|---|
| Q1 | **Where is `csa.ufv.ca` hosted, on which plan, and who owns the account?** (Vercel team? UFV server? What does 198.162.116.23 point to?) Which branch deploys? | **Blocker** |
| Q2 | **Who owns and approves changes to the main repo?** It lives on `DevelopsS15`'s personal account. Will they accept a PrintQ PR, and can it move to a CSA GitHub org? | **Blocker** |
| Q3 | **Discord server ID** (likely `287455376994205716` per `config.ts:16`, please confirm), the **verified role ID**, and **how students get verified today** (bot? manual? email domain?) | **Blocker** for 1.3 |
| Q4 | Who will own the **Supabase** org/project and the **PrintQ Discord application**, and who holds the secrets (two execs + faculty advisor)? Does the CSA already have Supabase/Vercel/Cloudflare accounts? | **Blocker** for deploy |
| Q5 | **Lab hours** and where the printer physically is (SCC D224?), plus holiday closure rules | **Blocker** for slot UX (engine can be built with config) |
| Q6 | What currently calls `/api/events/reminders` and `/api/announcements/ufv-news`? Is there an existing scheduler PrintQ could reuse? | Not a blocker |
| Q7 | Exact printer model (MK4S/MK4/MK3.9/MK3S+, single or MMU) for model validation and fixtures | Not a blocker (fixtures needed by 1.4) |
| Q8 | Who are the first PrintQ admins and staff (Discord IDs)? Do you want a Discord "PrintQ Staff" role to drive this? | Not a blocker |
| Q9 | Do UFV or the student union have a privacy requirement or contact for student-group systems? Is a Canadian data region required? | Not a blocker for build, **blocker for launch** |
| Q10 | Padding %, buffer minutes, hold TTL, max concurrent bookings, file retention days | Not a blocker (settings table) |
| Q11 | DNS control for `ufv.ca` subdomains (only relevant if Option B is chosen) | Not a blocker under A |
| Q12 | Policy on public schedule detail: show names or only "booked"? | Not a blocker (default: no names) |

---

## 8. Appendix

### 8.1 Commands run (sandbox: Node 22.22.0, npm 10.9.4, Linux)

| Command | Result |
|---|---|
| `git status; git log; git rev-parse HEAD origin/master` | Clean tree. HEAD = origin/master = `9b4c6f4`. Shallow clone. 53 commits visible, all by `DevelopsS15`. Latest 2026-09-06. |
| `find . -name vercel.json -o -name netlify.toml -o -name Dockerfile -o -name CNAME -o -name wrangler.toml -o -name .nvmrc -o -name "*.test.*" ...` | No matches |
| `grep -rhoE "process\.env\.[A-Z_0-9]+" app sanity.config.ts next-sitemap.config.js` | 20 names (§2.10) |
| Secret scan: `grep -rnIE` for common token patterns (`ghp_`, `AKIA`, `xox`, Discord bot token shape, `BEGIN` keys, `secret=`) excluding `node_modules` and the lockfile | 4 hits, all in `assets/*.pixil` (base64 pixel-art image data; **false positives**). No credentials found. |
| `tar -tzf assets/sanity-prd.tar.gz` + per-type key summary of `data.ndjson` (values not printed; extracted copy deleted) | 72 files. Doc types include `roomStatus(discordUserId)`, `executives(fullName, discordId, discordUsername)`, `meetingMinutes(attendance)`. No token fields. |
| `npm ci --no-audit --no-fund` | ✅ 1,543 packages, 30 s |
| `npm run lint` | ✅ no warnings/errors, 4 s (`next lint` deprecation notice) |
| `npx tsc --noEmit` | ✅ 8 s |
| `npm run build` | ❌ 82 s. Compiled OK; failed collecting page data for `/api/announcements/latest`: `Configuration must contain projectId` (Sanity env missing) |
| `npm outdated` | See §2.13 |
| `npm audit` / `npm audit --json` | 24 vulns (1 low, 3 moderate, 20 high). See §2.13. |
| `npm ls postcss` | `next/node_modules/postcss@8.4.31 invalid: "8.5.28"`. Override not applied. |
| `getent hosts csa.ufv.ca` | `198.162.116.23` |
| `curl -sI https://csa.ufv.ca/`, WebFetch `csa.ufv.ca`, `vercel.com`, `supabase.com`, `discord.com` docs; RDAP lookup | **Blocked by sandbox egress proxy** (403). Limits taken from web search results instead; re-verify. |
| GitHub API: repo search, workflow runs for `devnull03/ufv-csa` | Upstream `DevelopsS15/ufv-csa` is public, default `master`, homepage `https://csa.ufv.ca`. 0 workflow runs. |

### 8.2 Web sources used for limits (search snippets; primary docs were blocked)

- Vercel limits: https://vercel.com/docs/limits , https://vercel.com/docs/functions/limitations , https://vercel.com/docs/cron-jobs/usage-and-pricing
- Supabase pricing: https://supabase.com/pricing
- Discord interactions: https://discord.com/developers/docs/interactions/receiving-and-responding , https://discordjs.guide/slash-commands/response-methods

### 8.3 Files consulted

`package.json`, `package-lock.json` (lockfile version), `tsconfig.json`, `next.config.mjs`, `next-sitemap.config.js`, `tailwind.config.ts`, `postcss.config.js`, `components.json`, `.eslintrc.json`, `.gitignore`, `README.md`, `sanity.config.ts`, `sanity.cli.js`, `app/globals.css`, `app/(site)/layout.tsx`, `app/(site)/config.ts`, `app/(site)/utils.tsx`, `app/(site)/client.ts`, `app/(site)/serverClient.ts`, `app/(site)/components/{NavBar,NavBarSliderPanel,NavBarAboutDropdown,Footer,LayoutWrapper,LogoWithCSAStacked,LatestAnnouncementBanner}.tsx`, `app/(site)/components/UI/button.tsx`, `app/(site)/api/utils.ts`, `app/(site)/api/webhooks/discord/interact/route.ts`, `app/(site)/api/webhooks/sanity/events/route.ts`, `app/(site)/api/events/reminders/route.ts`, `app/(site)/api/room-status/route.ts`, `app/(site)/api/announcements/{latest,ufv-news}/route.ts`, `app/(site)/discord/route.tsx`, `app/(site)/contact/page.tsx`, `app/(studio)/studio/[[...index]]/{layout,page}.tsx`, `app/sanity/lib/{token,query}.ts`, `app/sanity/constants.ts`, `app/sanity/schemas/{index,executives,roomStatus}.ts`, `assets/sanity-prd.tar.gz` (structure only).
