# PrintQ: Discord bot plan

PrintQ runs inside the **existing CSA Discord app**, the one that already handles `/sccroom`. It is not a separate bot. Everything goes through the existing HTTP interactions endpoint (`app/(site)/api/webhooks/discord/interact/route.ts`). There is no always-on gateway process, so nothing extra runs on the UFV server.

> **Status: built** on `feat/printq-local` (phases D1–D6 below). The rest of this page is the design; §9 lists where the build differs from it and how to set it up.

Goal: staff can run the printer from one private channel. The bot posts requests and updates there, and staff approve, run sessions and change availability from it. The website stays the full UI for students. Discord is the fast lane for staff and a convenience for members.

## 1. What exists today

| Piece | Where | State |
|---|---|---|
| `/sccroom open:true/false` | `interact/route.ts` | **Existing site feature.** Only members with `DISCORD_SCC_ROOM_ROLE_ID` can use it. It renames the room channel to `🔓 open`/`🔐 closed`, posts an embed there and saves the status in Sanity. PrintQ hooks in after that (`room-status.ts` → "the lab is open" DMs to today's bookers). |
| `/print schedule` / `mine` / `cancel` | `app/printq/discord/handlers.ts` | ✅ built and tested. Schedule is anonymous; cancel has autocomplete. |
| New-request post in `PRINTQ_ADMIN_CHANNEL_ID` with **Approve / Reject / Open in PrintQ** | `notify.ts`, `handlers.ts` | ✅ built. Reject asks for a reason in a modal. The message is updated in place with the verdict. |
| DMs: request received, approved/rejected/cancelled/finished/failed, 24 h and 1 h reminders, lab opened, hold expired | `notify.ts` | ✅ built. Every message is logged in `printq.notifications`. |
| Staff check on every click | `profiles.ts` `viewerForDiscordId` | ✅ built. Discord user → PrintQ profile with role ≥ staff. |

**What's missing for "run it from the channel":**

1. The request post is a one-off. If a booking is approved **on the website**, or later starts printing or finishes, the Discord message doesn't change.
2. There are no buttons for the session after approval (check in, start, finish, fail, collect, no-show).
3. Availability can't be changed from Discord: no closures, lab hours or printer maintenance. (The website settings pages are also still read-only.)
4. There's no overview message in the channel (today's queue, pending count, lab open/closed).
5. Lab open/close lives only in `/sccroom`, in a different channel.

## 2. The staff channel

One private channel, **#printq-staff** (`PRINTQ_ADMIN_CHANNEL_ID`). It's visible to the staff role only and holds two kinds of bot message:

### 2.1 The board (one pinned message, always edited, never re-posted)

```
┌ PrintQ · Prusa MK4S ─────────────────────────────── 🟢 Lab open · since 10:02 ┐
│ Now printing   Drone arm mount · ends 2:15 PM                                  │
│ Waiting        3 requests need review                                          │
│ Today          10:00 Phone stand ✅ · 1:00 Gear set v2 ⏳ · 3:30 free           │
│ Tomorrow       10:30 Cable clips ✅ · 1:00 Robot chassis ✅                     │
│ Closures       Thu 10–11 Nozzle swap 🔧 · Fri 12:30–4 CSA meeting               │
│ Hours          Mon–Thu 10–6 · Fri 10–4                                         │
└────────────────────────────────────────────────────────────────────────────────┘
[ 🔐 Close lab ] [ ➕ Add closure ] [ 🕒 Lab hours ] [ 🔧 Printer: active ▾ ] [ ↻ ]
```

- **Open/Close lab** does **exactly** what `/sccroom` does: renames the room channel, posts in it, saves to Sanity and runs the PrintQ hook. `/sccroom` is refactored into a shared `setRoomStatus(isOpen, discordUserId)`, so the command and the button can't drift apart. `/sccroom` keeps working unchanged, and so does its role (`DISCORD_SCC_ROOM_ROLE_ID`).
- **Add closure** opens a modal with *When* (`Fri 12:30-16:00`, `Oct 9 all day`, `today 2pm-3pm`), *Reason* and *Kind* (closure/maintenance). It replies with a confirmation (§2.3) before saving.
- **Lab hours** shows the weekly hours with one button per weekday. Each button opens a modal (`10:00-18:00`, or `closed`).
- **Printer** is a select menu: Active / Maintenance / Retired. Maintenance blocks new bookings and asks what to do with upcoming approved ones (§2.3).
- The board is edited after **every** change, whether it came from the website, Discord or cron. Cron also refreshes it every 15 min, so "now/next" stays true.

### 2.2 Request cards (one message per booking, edited for its whole life)

```
┌ ⏳ Pending · Gear set v2 ─────────────────────────────────────────────┐
│ @chen.w · Course project                                             │
│ Tue Oct 6, 1:00 PM → 3:00 PM (2 h) · 24 g PLA · 0.2 mm · MK4S ✓       │
│ gear_set_v2_0.2mm_PLA_MK4S.bgcode                    [thumbnail]      │
│ Hold expires in 38 h                                                  │
└───────────────────────────────────────────────────────────────────────┘
[ ✅ Approve ] [ ❌ Reject ] [ 🕒 Move time ] [ Open in PrintQ ]
```

The buttons always come from the state machine (`allowedActions()`), so Discord and the website offer the same actions:

| Status | Buttons |
|---|---|
| pending | Approve · Reject (reason modal) · Move time (modal) · Open |
| approved | Check in · No-show · Cancel (reason modal) · Move time · Open |
| checked_in | Start print · Cancel |
| printing | Finished · Failed (reason modal) |
| finished | Collected |
| rejected / cancelled / expired / collected / failed / no_show / lab_closed | none; the card turns grey and shows who decided and why |

- **Updates go into a thread** on the card (`Sam approved · 10:14`, `Printing started`, `Reminder sent to member`, `Member cancelled`). This keeps the channel to one card per booking, and its history stays readable.
- **Move time** takes a new start time (`Wed 2pm`). The booking keeps its length. The database's no-overlap rule rejects a clash, and the bot answers "That overlaps Robot chassis (1–4:30)". The member gets a DM: *"Staff moved your print to Wed 2:00 PM. [Keep it] [Cancel booking]"*.
- **Double clicks and two staff at once:** whoever clicks second gets a private "Already approved by @sam" reply, and nothing changes.

### 2.3 Confirmations for anything that affects members

Closures, lab hours and printer maintenance can land on top of approved bookings. The bot never changes those silently. It answers privately first:

```
Close Fri Oct 9, 12:30 PM → 4:00 PM (CSA general meeting)?
This affects 2 approved prints: Robot chassis (@ola.n), Name plate (@priya.s).
They'll get a DM and their booking is marked "Lab closed".
[ Close and notify ] [ Close, keep bookings ] [ Cancel ]
```

## 3. Slash commands

| Command | Who | What |
|---|---|---|
| `/print schedule [show_in_channel]` | everyone | ✅ exists |
| `/print mine` | everyone | ✅ exists |
| `/print cancel <booking>` | everyone | ✅ exists |
| `/printstaff pending` | staff | Private list of requests needing review, each with a button that opens its card |
| `/printstaff booking <search>` | staff | Finds any booking (autocomplete by title/member/date) and shows its card privately with actions |
| `/printstaff close <when> <reason> [maintenance]` | staff | Same as the board's *Add closure* button (with autocomplete for times) |
| `/printstaff reopen <closure>` | staff | Removes a closure (autocomplete over upcoming ones) |
| `/printstaff hours [day] [hours]` | admin | View or set lab hours |
| `/printstaff board` | staff | Re-posts and re-pins the board if someone deleted it |
| `/sccroom open:<bool>` | room role | Unchanged; now shares code with the board button |

Staff commands are a separate top-level `/printstaff` command. Discord can hide a whole command from non-staff (`default_member_permissions`, then allow the staff role under Server Settings → Integrations), but not a single subcommand. The server still checks the role on every call; hiding the command is only cosmetic.

## 4. Members' side

- **DMs** (exist) gain buttons: *Cancel booking* on approval and reminder DMs, and *Keep / Cancel* after a time move.
- **DMs closed:** we can't message the member. The staff card's thread says "Couldn't DM @maya.k". We never post member details in a public channel.
- **Optional public board** (`PRINTQ_PUBLIC_CHANNEL_ID`): a pinned, anonymous "this week" schedule in e.g. #3d-printing, refreshed like the staff board, with a *Book a print* link. Same rules as `/print schedule`: no names.

## 5. How it's built

- **One change hook.** Every booking change, from the website, Discord or cron, already goes through `transitionBooking`, and closures and hours get a matching `availability.ts` service. After each change, `discord/sync.ts` re-renders the booking's card and the board (and the public board). This is what keeps Discord and the website consistent: approving on the website updates the Discord card.
- **Message tracking.** A new `printq.discord_messages` table (`kind: card|board|public_board`, `booking_id`, `channel_id`, `message_id`, `thread_id`) records which message to edit. If a message was deleted (Discord returns 404), the bot posts a fresh one and stores the new id.
- **The 3-second rule.** Discord expects an answer within 3 seconds. Single-booking clicks are quick database writes, so they answer immediately by updating the message in place (as approve does now). Bigger actions (a closure with affected bookings, a board refresh, maintenance mode) acknowledge first (deferred update), then finish in `after()` and edit the original message.
- **Who is staff.** The `PRINTQ_STAFF_ROLE_ID` Discord role on the clicking member (sent with every interaction, so no website sign-in is needed), **or** a PrintQ profile with role ≥ staff. Admin-only actions (lab hours) need the PrintQ admin role. Checked again on every click; button ids are never trusted.
- **Audit.** Every Discord action writes `booking_events` / `closures.created_by` with the staff member's user id, exactly as the website does.
- **Security fix carried over from the audit:** the interactions endpoint checks the signature but not how old the request is. Add a ±5 min check on `x-signature-timestamp` so a captured request can't be replayed.
- **Bot permissions in #printq-staff:**
  - View Channel, Send Messages, Embed Links, Attach Files (thumbnails);
  - Create Public Threads, Send Messages in Threads;
  - Manage Messages (to pin the board).

  *Manage Channels* in the room channel already exists for `/sccroom`.
- **Registration.** `npm run discord:register` adds `/print` and `/printstaff` one at a time and never touches `/sccroom` (already true for `/print`).

## 6. Demo mode and testing

Demo mode keeps everything working without a real server:

- Cards, board and DMs are rendered into the outbox exactly as they'd be sent (embeds and buttons).
- The staff dashboard gets a **Discord preview** panel. It draws the board and cards like Discord and makes the buttons clickable. A click is sent as a fake interaction to the **same handler** Discord would call, so testing it in the browser tests the real code path.
- Integration tests (Postgres, Discord API mocked, like `discord.db.test.ts`) cover:
  - card created on request and edited on each transition (from website and Discord);
  - session buttons; move time with a clash;
  - closure confirmation with affected bookings;
  - lab toggle shared with `/sccroom`;
  - deleted message re-posted; non-staff click refused; stale timestamp refused.

## 7. Phases

| # | What | Size | Needs |
|---|---|---|---|
| D1 | Living request cards: `discord_messages` table, `sync.ts`, edit on every change, per-state buttons, update thread | M | none |
| D2 | Session buttons + fail/cancel reason modals + member DM buttons | S | D1 |
| D3 | `availability.ts` (closures, lab hours, printer status) with confirmation flow. Used by Discord **and** the website settings pages, which stop being read-only | M | none |
| D4 | Staff board + `/printstaff` commands + shared `setRoomStatus` for the lab button | M | D1, D3 |
| D5 | Move time + member Keep/Cancel; optional public board | S | D1 |
| D6 | Demo-mode Discord preview; timestamp check; tests | S | alongside each phase |

## 8. Decisions needed

1. **Lab button = `/sccroom`?** Recommended: yes, one shared action (same channel rename and post). The alternative is a PrintQ-only status, which the room channel would never show.
2. **Who is staff on Discord:** a `PRINTQ_STAFF_ROLE_ID` role (recommended; no website sign-in needed), or only people promoted on the website.
3. **Threads per request** (recommended), or plain replies in the channel.
4. **Public board** in a members' channel: yes/no, and which channel.
5. **Lab hours from Discord:** admins only (recommended), or all staff.

## 9. As built

All six phases are implemented. Code map:

| Piece | File |
|---|---|
| Message renderers (cards, board, public board, modals, confirmations) | `app/printq/discord/render.ts` |
| Post-once-then-edit sync, threads, pins, re-post on 404, demo storage | `app/printq/discord/sync.ts` + `printq.discord_messages` (migration 0004) |
| Buttons, select menus, modals, `/print` and `/printstaff` | `app/printq/discord/handlers.ts` |
| Staff check (PrintQ role, `PRINTQ_STAFF_ROLE_ID`, `PRINTQ_ADMIN_DISCORD_IDS`) | `app/printq/discord/staff.ts` |
| Shared lab toggle used by `/sccroom` and the board | `app/printq/discord/room.ts` |
| Closures, lab hours, confirmation drafts | `app/printq/availability.ts` |
| Date phrases (`Fri 12:30-4pm`, `Oct 9 all day`, `Wed 2pm`) | `app/printq/scheduling/when.ts` |
| Move time | `moveBooking` in `app/printq/bookings.ts` |
| Replay protection (±5 min timestamp) | `app/printq/discord/freshness.ts`, used by `verifyInteractionRequest` |
| Demo preview (clickable channel, public board, DMs) | `/printing/admin/discord`, `app/printq/ui/DiscordPreview.tsx`, `POST /api/printq/demo/discord` |
| Website editors using the same service | closures on `/printing/admin/schedule`, lab hours on `/printing/admin/settings` |

**Differences from the plan:**

- **No printer-status select on the board.** The site treats "no active printer" as "PrintQ is unavailable" in 15 places, so flipping the printer to maintenance would take the whole booking site down. Instead, staff add a closure of type **maintenance**, which already blocks the printer outright (running prints too), shows on the schedule and goes through the same confirmation.
- **Decisions (§8) taken with the recommended options:** the lab button is `/sccroom`; staff are recognised by role; one thread per request; lab hours are admin-only. The public board is on whenever `PRINTQ_PUBLIC_CHANNEL_ID` is set.
- **Pending cards show Reject instead of Cancel.** Staff can technically cancel a pending request, but Reject (with a reason) is the right action there.

**Setup on the real server:**

1. Create **#printq-staff** (private, staff role only). Give the CSA app: View Channel, Send Messages, Embed Links, Create Public Threads, Send Messages in Threads, Manage Messages (to pin). Optional: a public channel for the anonymous board (View Channel, Send Messages, Embed Links, Manage Messages).
2. Set `PRINTQ_ADMIN_CHANNEL_ID`, optionally `PRINTQ_PUBLIC_CHANNEL_ID`, and `PRINTQ_STAFF_ROLE_ID` (the Discord role whose members count as staff).
3. `npm run discord:register` (dry run), then `npm run discord:register -- --apply`. This adds/updates `/print` and `/printstaff` one at a time and never touches `/sccroom`.
4. In Server Settings → Integrations → CSA app, allow `/printstaff` for the staff role (it's hidden from everyone by default).
5. Run `/printstaff board` once in #printq-staff to post and pin the board. Cards appear by themselves as requests come in.

**Try it without Discord:** with `PRINTQ_DEMO=true`, sign in as the demo staff account and open **Staff → Discord**. Everything there runs through the same handler Discord would call.
