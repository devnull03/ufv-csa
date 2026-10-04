# PrintQ: Design Brief

**For:** the design agent.

**Scope:** every page, component, state and Discord surface PrintQ needs, plus the design system it must match.

**Status:** the routes and placeholder UI exist on branch `feat/printq-local`. Every placeholder is marked with a dashed outline and a `PLACEHOLDER` label. Replace them with real designs, keeping the component names and props below so the wiring keeps working.

---

## 0. Product in one paragraph

PrintQ is a **free, in-person 3D printer reservation system** for the UFV Computing Student Association (CSA). There is one shared Prusa FDM printer to start, with more later. Members of the CSA Discord server sign in with Discord.

The booking flow:

1. The member slices their model in PrusaSlicer.
2. They upload the `.gcode` or `.bgcode` file.
3. The server reads the print time, filament weight, printer model and a thumbnail.
4. The member picks a start time that falls inside **lab hours**.
5. The slot is **held** while an admin reviews the request.
6. An admin **approves** or **rejects** it.
7. The member comes to the lab (SCC, room D224) at their slot and starts the print themselves.
8. Staff record each step manually: checked in → printing → finished → collected. A missed slot is a no-show.

There are **no payments or prices** anywhere.

## 1. Users and permissions

| Role | Who | Can see |
|---|---|---|
| **Visitor** | anyone, signed out | Public schedule (times and status only, **never names**), rules, privacy, login |
| **Member** | signed in with Discord **and** in the CSA server **and** has the verified role | Everything above, plus new booking, my prints, booking detail, cancel |
| **Signed in, not eligible** | signed in but not in the server or missing the role | Public pages and an "eligibility" explainer with a Discord invite |
| **Staff** | Member with `staff` role | Everything above, plus admin: dashboard, approvals, session control, schedule |
| **Admin** | Member with `admin` role | Everything above, plus settings, users, audit log |

---

## 2. Design system: match the existing CSA site exactly

PrintQ pages render **inside the existing site layout**: the same NavBar, Footer, announcement banner and forced dark theme. Do not introduce a new visual language.

- **Theme:** dark mode is always on (`<html class="dark">`). Designing light mode is optional and low priority.
- **Font:** Inter (Latin). The site uses Tailwind's default type scale.
- **Brand greens** (from the CSA leaf logo):
  - Dark `#36853f`.
  - Light `#8fc63d`, used for the logo wordmark.
  - Blended `#52a040`, used for the theme colour and Discord embeds.
  - Use green for "available", primary CTAs and success.
- **Surfaces as actually used** (Tailwind slate):
  - Page background: `slate-800`.
  - Nav and footer: `slate-900`, with a `slate-700` border.
  - Cards and panels: `slate-900`, `slate-700` border, `rounded-lg` (0.5rem radius).
  - Popovers: `slate-900`, `slate-800` 2px border.
  - Muted text: `hsl(215 20.2% 65.1%)`. Foreground: `hsl(210 40% 98%)`.
- **Content width:** `w-11/12 md:w-10/12 lg:w-9/12`, centred, matching the NavBar.
- **Buttons:** existing variants are `default`, `information` (blue-500), `success` (green-500), `warning` (yellow-500), `danger` (red-500), `outline`, `secondary`, `ghost`, `link` and `theme`. Sizes are `default`, `xs`, `sm`, `lg`, `icon` and `xsicon`. Buttons support `loading` (spinner) and a leading or trailing `icon`.
- **Icons:** `lucide-react` (0.349). Use `@icons-pack/react-simple-icons` for brand marks (Discord, Prusa if needed).
- **Existing primitives** in `app/(site)/components/UI/`: accordion, avatar, badge, button, carousel, checkbox, command, dialog, dropdown-menu, input, label, navigation-menu, popover, progress, select, separator, sheet, skeleton, slider, sonner (toasts), table, tabs, tooltip.
  - **To add** (shadcn, Tailwind v3 versions): `calendar`, `card`, `alert`, `textarea`, `form`, `toggle-group`.
- **Breakpoints:** Tailwind defaults (sm 640, md 768, lg 1024, xl 1280, 2xl 1400 container). **Mobile matters:** students check their slot on their phone.
- **Accessibility:**
  - WCAG AA contrast.
  - Never convey status by colour alone; always pair it with an icon or text.
  - Focus rings via `ring`.
  - Keyboard-operable calendar and slot picker.

### 2.1 Status vocabulary (used everywhere)

| Status key | Label | Meaning | Suggested colour and icon |
|---|---|---|---|
| `pending` | Awaiting approval | Slot held until the hold expires | yellow · `Hourglass` |
| `approved` | Confirmed | Approved; come in at slot time | green · `CalendarCheck` |
| `rejected` | Rejected | Admin rejected it, with a reason | red · `XCircle` |
| `expired` | Hold expired | Not reviewed before the hold ran out | slate · `TimerOff` |
| `cancelled` | Cancelled | Cancelled by the member or an admin | slate · `Ban` |
| `checked_in` | Checked in | Member is in the lab | blue · `LogIn` |
| `printing` | Printing | Print started | blue (animated) · `Printer` |
| `finished` | Ready for pickup | Print done; collect it | green · `PackageCheck` |
| `collected` | Collected | Done | slate · `CheckCircle2` |
| `no_show` | No-show | Member didn't arrive within the grace period | red · `UserX` |
| `failed` | Print failed | Print failed; may rebook | red · `AlertTriangle` |
| `lab_closed` | Lab was closed | Lab closed at slot time; priority rebook | orange · `DoorClosed` |

**Lab status** (live, from the existing `/sccroom` Discord toggle):

- `open`: green dot, "Lab open".
- `closed`: slate dot, "Lab closed".
- Plus "since 2:14 PM".

---

## 3. Page tree

```
/printing                          Public schedule + intro                       (public)
/printing/rules                    How it works, rules, FAQ                      (public)
/printing/login                    Sign in with Discord + eligibility states     (public)
/printing/new                      New booking wizard (4 steps)                  (member)
/printing/me                       My prints (upcoming / past)                   (member)
/printing/me/[id]                  Booking detail + timeline + cancel            (member, owner)
/printing/admin                    Staff dashboard (today at a glance)           (staff)
/printing/admin/approvals          Approval queue                                (staff)
/printing/admin/session            Live session control for today                (staff)
/printing/admin/schedule           Calendar manager, closures, blocks            (staff)
/printing/admin/settings           Lab hours, booking policy, printers           (admin)
/printing/admin/users              Members, roles, bans                          (admin)
/printing/admin/audit              Audit log                                     (admin)
/privacy                           Site-wide privacy policy (new, required)      (public)
```

Plus the **NavBar entry** "3D Printing" (desktop and mobile sheet), and the **Discord surfaces** in §6.

---

## 4. Pages

Each page entry lists its purpose, layout (top to bottom), components used, data shown, and states. **Every page needs:** a loading skeleton, an error state and an empty state.

### 4.1 `/printing`: Public schedule

**Purpose.** Show when the printer is free, and convince members to book.

**Layout:**

1. **`PrintQHeader`**: title "3D Printing", a one-line pitch ("Free for CSA members. Slice it, book it, print it."), `LabStatusBadge`, and the primary CTA "Book a print". A signed-out visitor sees "Sign in with Discord" instead.
2. **`PrinterCard`**: printer name and model, a photo or illustration, current state (Idle / Printing until 4:30 PM / Out of service), and the build volume.
3. **`WeekSchedule`** (public mode):
   - A 7-day view with a week switcher (← This week →).
   - **Lab hours** are shaded as bookable.
   - Bookings appear as blocks labelled only "Booked" or "Pending".
   - Closures show as hatched blocks with their reason (e.g. "Reading break").
   - The current time is a line.
   - On mobile it collapses to a **day list** (`DayAgenda`).
4. **`LabHoursSummary`**: the weekly hours table and the next closure.
5. **How it works**: a 4-step strip (`StepsStrip`): Slice → Upload → Pick a time → Get approved & print.

**States:**

- No lab hours configured: "Schedule coming soon."
- Printer out of service: banner.
- Lab open right now: the badge pulses subtly.

### 4.2 `/printing/rules`: Rules and FAQ

Static content, edited in code for now.

- Sections: Eligibility, What you can print, Materials (PLA/PETG only, TBD), Slicing requirements (PrusaSlicer profile for the exact printer), Max print length, Booking and holds, Check-in and no-shows, Pickup, Failed prints, Privacy summary (link to `/privacy`).
- Components: `RulesSection`, existing `Accordion` for the FAQ, `Callout` (info/warning).

### 4.3 `/printing/login`: Sign in

Use a centred card (`AuthCard`). The card has one of these states:

| State | Content |
|---|---|
| Default | Discord logo, "Sign in with Discord" button (Discord blurple `#5865F2`, or the CSA green; designer's choice), and a small note: "We only see your Discord username and ID." |
| Redirecting | Button shows a spinner |
| `not_in_server` | "Join the CSA Discord first", with an invite button and "Try again" |
| `missing_role` | "You need the verified role", with steps to get verified and "Try again" |
| `banned` | "Your booking access is paused until DATE", plus a contact line |
| `oauth_error` | Generic error with retry |

### 4.4 `/printing/new`: New booking wizard

**Purpose.** The core flow. It is a 4-step wizard with a **`WizardStepper`** at the top (Upload · Review · Pick time · Confirm). Progress is kept if the user goes back.

**Step 1: Upload (`GcodeDropzone`)**

- A drag-and-drop zone with a "Choose file" button.
- Accepted types: `.gcode` and `.bgcode`, max 50 MB. An inline hint links to a "How to slice for our printer" accordion.
- States:
  - idle;
  - drag-over;
  - uploading (progress bar with percent, filename and cancel);
  - parsing (spinner, "Reading your file…");
  - errors: wrong type, too large, unreadable, **wrong printer model** ("This was sliced for MK3S, our printer is MK4S. Re-slice with the right profile."), print too long.

**Step 2: Review (`GcodeSummaryCard`)**

- The **thumbnail** from the file, or a fallback illustration.
- Filename.
- **Print time** (as estimated by the slicer).
- **Booked duration** (estimate × padding + buffer, with a tooltip explaining the padding).
- **Filament** (grams; type if known).
- **Printer model** with a match check.
- **Object size** (X × Y × Z mm, with a bed-fit check).
- An optional **notes** textarea (`Textarea`, 500 chars) and an optional "Model link" (Printables or Thingiverse URL).
- Warnings shown via `Callout`, e.g. "Long print: over 8 h".

**Step 3: Pick time (`SlotPicker`)**

- A date strip or calendar (`Calendar`) showing the next 14 days. Days with no availability are disabled. Days with lab hours carry an availability dot.
- For the chosen day, start times are chips (`TimeSlotChip`) in 15-minute steps. **Only times inside lab hours are offered as starts.**
- Each chip shows the start, and the end on hover or when selected: "2:00 PM → 6:45 PM".
- If the print runs past closing: a label "Runs past lab close; pick up next open day", or the chip is disabled if policy forbids it.
- Visual cues on the timeline: the selected block, other bookings (grey), lab-hour bands and closures.
- States: loading availability; no slots in the next 14 days.

**Step 4: Confirm (`BookingSummary`)**

- A recap: thumbnail, time, duration, notes.
- A rules checkbox: "I've read the rules and will arrive on time" (`Checkbox`).
- Submit button. After submitting, the **`HoldCountdown`** explains that the slot is held for N hours pending approval, with "You'll get a Discord DM when it's reviewed."
- Error if the slot was taken meanwhile (race), with "Pick another time."

### 4.5 `/printing/me`: My prints

- `Tabs`: **Upcoming** (pending, approved, checked_in, printing, finished) and **Past** (everything else).
- A list of **`BookingCard`** items: thumbnail, title (filename), date and time range, `StatusBadge`, and the next action ("Cancel", "View").
- Empty state: an illustration with "No prints yet" and a "Book a print" CTA.
- Header shows usage: "2 of 3 active bookings used" (`QuotaMeter`).

### 4.6 `/printing/me/[id]`: Booking detail

- **`BookingHeader`**: thumbnail, filename, `StatusBadge`, slot time, and an "Add to calendar" (.ics) button.
- **`StatusTimeline`**: vertical steps with timestamps (Requested → Approved → Checked in → Printing → Ready → Collected). Terminal states (rejected, no-show and so on) show a reason.
- **`GcodeSummaryCard`** (compact variant).
- Actions: **Cancel booking** (danger, opens a confirm `Dialog`; only available before check-in) and **Download my file**.
- Admin notes visible to the member, e.g. a rejection reason.

### 4.7 `/printing/admin`: Staff dashboard

- **`AdminNav`**: a secondary nav (tabs on desktop, select on mobile): Dashboard · Approvals (with count badge) · Session · Schedule · Settings · Users · Audit. Settings, Users and Audit are hidden for staff.
- A row of **`StatTile`**s: Pending approvals, Today's prints, Printing now (with ETA), No-shows this week.
- **`TodayAgenda`**: today's bookings in order, with quick actions.
- `LabStatusBadge` with a hint: "Toggle with /sccroom in Discord".

### 4.8 `/printing/admin/approvals`: Approval queue

- A list or table of **`ApprovalCard`** items, oldest first:
  - requester (Discord avatar, display name, `@username`);
  - thumbnail, requested slot, duration, filament, model check;
  - notes;
  - **hold expires in** countdown;
  - conflicts warning.
- Actions per card: **Approve** (success) and **Reject** (danger, opens a `RejectDialog` with a preset reasons select plus free text). "Download file" for inspection.
- Bulk-approve is **not** needed in v1.
- Empty state: "All caught up".

### 4.9 `/printing/admin/session`: Live session control

**Purpose.** A tablet-friendly screen staff use in the lab. It needs big tap targets.

- **`SessionCard`** for each booking today, with a large primary action for the next step:
  - approved → **Check in**;
  - checked_in → **Start print**;
  - printing → **Mark finished** (with **Failed**);
  - finished → **Collected**.
- Secondary actions: **No-show** (enabled after the grace period) and **Lab closed**.
- An undo toast after every action (`sonner`).
- A "Printing now" hero card with elapsed time vs the estimate (`Progress`).

### 4.10 `/printing/admin/schedule`: Schedule manager

- **`WeekSchedule`** (admin mode): the same component as the public one, but blocks show requester names, and you can click a block to open a `BookingDrawer` (`Sheet`) with full detail and actions.
- **`ClosureForm`** (`Dialog`): date range, all-day or time range, reason, and "Notify affected members" (checkbox). Affected bookings are listed before saving.
- **Block time** (maintenance): the same form with type = maintenance.

### 4.11 `/printing/admin/settings`: Settings (admin)

`Tabs`: **Lab hours** · **Booking policy** · **Printers**.

**Lab hours (`LabHoursEditor`):**

- A row per weekday, each with zero or more time ranges (`TimeRangeInput`), plus "add range" and "copy to all weekdays".
- Timezone is fixed to America/Vancouver and shown as a label.
- **"Suggest from room history"**: a button that proposes hours from past `/sccroom` toggles. Design the review state.

**Booking policy (`PolicyForm`)** fields:

- Padding % (slider, 0–50).
- Buffer between prints (minutes).
- Hold time before auto-expire (hours).
- Check-in grace (minutes).
- Max active bookings per member.
- Max print duration (hours).
- How far ahead members can book (days).
- **Prints must finish within lab hours** (switch).
- File retention after completion (days).

**Printers (`PrinterForm`):**

- Name, model (select: MK4S, MK4, MK3.9, MK3S+, CORE One), bed size, status (active / maintenance / retired) and notes.
- Future fields are visible but disabled: "PrusaLink address", "Connect automatically" ("Coming soon").

### 4.12 `/printing/admin/users`: Users (admin)

- A searchable `Table`: avatar, display name, `@username`, role (`RoleSelect`: member/staff/admin), eligibility (in server ✓, verified ✓, last checked), active bookings, no-shows count, and banned-until.
- Row actions: change role, **Ban** (dialog: until date + reason), unban, re-check eligibility.

### 4.13 `/printing/admin/audit`: Audit log

- A `Table` with filters (actor, booking, action, date range): time, actor, action ("approved booking #123"), from → to status, and note.
- Pagination.

### 4.14 `/privacy`: Privacy policy (site-wide)

- Long-form text page in the existing site style (like `/regulations`).
- Sections: what we collect (Discord ID, username, avatar, bookings, uploaded files), why, where it's stored (CSA server at UFV, Canada), retention, who can see it, contact or deletion requests.

---

## 5. Component inventory

Component names are fixed. Props are indicative; designers may add visual variants.

### 5.1 Shared or brand components

| Component | Description | Props / variants | States |
|---|---|---|---|
| `StatusBadge` | Booking status pill (icon + label) | `status` (§2.1), `size: sm \| md` | — |
| `LabStatusBadge` | Live lab open or closed | `open: boolean`, `since: Date` | open (pulse), closed, unknown |
| `PrinterStatusPill` | Printer state | `state: idle \| printing \| maintenance \| offline`, `until?` | — |
| `Callout` | Inline info, warning or danger message | `tone: info \| warning \| danger \| success`, `title`, `children` | — |
| `EmptyState` | Illustration + text + CTA | `icon`, `title`, `body`, `action?` | — |
| `PageHeader` / `PrintQHeader` | Title, subtitle, right-aligned actions | `title`, `description`, `actions` | — |
| `QuotaMeter` | "2 of 3 active bookings" | `used`, `max` | full (warning) |
| `HoldCountdown` | Time left on a pending hold | `expiresAt` | normal, < 1 h (warning), expired |
| `DurationText` | "4 h 45 m" formatting | `minutes` | — |
| `DiscordUserChip` | Avatar + name + @handle | `user`, `size` | — |
| `StepsStrip` | Horizontal "how it works" steps | `steps[]` | — |

### 5.2 Scheduling components

| Component | Description | Props / variants | States |
|---|---|---|---|
| `WeekSchedule` | 7-day time grid: lab-hour bands, bookings, closures, now-line | `mode: public \| admin`, `weekStart`, `bookings[]`, `labHours[]`, `closures[]`, `onSelectBooking?` | loading, empty, mobile → `DayAgenda` |
| `DayAgenda` | Mobile/list version of one day | same data for one day | — |
| `ScheduleBlock` | One block in the grid | `kind: booking \| pending \| closure \| maintenance \| selection`, `label`, `start`, `end` | hover, focus, selected |
| `LabHoursSummary` | Weekly hours table | `labHours[]`, `nextClosure?` | — |
| `SlotPicker` | Date strip + time chips + mini timeline | `days[]`, `slots[]`, `durationMin`, `value`, `onChange` | loading, no availability |
| `TimeSlotChip` | One start time | `start`, `end`, `runsPastClose`, `disabled` | default, selected, disabled |
| `Calendar` | shadcn calendar (react-day-picker 8) | — | — |

### 5.3 Booking components

| Component | Description | Props / variants | States |
|---|---|---|---|
| `WizardStepper` | 4-step progress | `steps[]`, `current` | complete, current, upcoming |
| `GcodeDropzone` | Upload area | `maxBytes`, `accept`, `onUploaded` | idle, drag-over, uploading %, parsing, error (each type in §4.4) |
| `GcodeSummaryCard` | Parsed file facts + thumbnail | `summary`, `variant: full \| compact` | model mismatch, too large, long print |
| `ThumbnailFrame` | Fixed-ratio image with fallback | `src?`, `alt` | loading, fallback |
| `BookingSummary` | Pre-submit recap | `booking draft` | — |
| `BookingCard` | List item for a booking | `booking`, `actions` | each status |
| `BookingHeader` | Detail page header | `booking` | — |
| `StatusTimeline` | Vertical lifecycle | `events[]`, `status` | terminal branches |
| `CancelBookingDialog` | Confirm cancel | `booking` | submitting |

### 5.4 Admin components

| Component | Description | Props / variants | States |
|---|---|---|---|
| `AdminNav` | Admin sub-navigation | `role`, `pendingCount` | — |
| `StatTile` | KPI number + label + trend | `label`, `value`, `hint?` | — |
| `TodayAgenda` | Today's bookings with quick actions | `bookings[]` | empty |
| `ApprovalCard` | Request awaiting review | `booking`, `onApprove`, `onReject` | conflicting, expiring soon |
| `RejectDialog` | Reason picker + text | `presetReasons[]` | submitting |
| `SessionCard` | Big-button lifecycle control | `booking`, `onAction` | each status |
| `BookingDrawer` | Side sheet with full booking detail + actions | `booking` | — |
| `ClosureForm` | Create or edit a closure or maintenance block | `initial?` | affected-bookings preview |
| `LabHoursEditor` | Weekday × time-range editor | `value`, `onChange` | validation errors (overlap, end before start) |
| `TimeRangeInput` | Start–end time pair | `value` | invalid |
| `PolicyForm` | Policy settings | `value` | dirty, saving, saved |
| `PrinterForm` | Printer settings | `printer` | — |
| `UsersTable` / `RoleSelect` / `BanDialog` | User management | — | — |
| `AuditTable` | Filterable log | `filters` | — |

### 5.5 Auth components

| Component | Description |
|---|---|
| `AuthCard` | Login card with the states listed in §4.3 |
| `UserMenu` | Small avatar menu (My prints, Admin (if staff), Sign out). Shown in `PrintQHeader`; **not** added to the global NavBar in v1. |

---

## 6. Discord surfaces (design the embeds too)

Everything goes through the existing CSA Discord app with **one `/print` command group**. Embed accent colour: `#52a040`.

| Surface | Trigger | Content |
|---|---|---|
| `/print schedule` (ephemeral) | Member command | Embed: today and tomorrow's free windows, lab status, link button "Book on website". `show_in_channel` option. |
| `/print mine` (ephemeral) | Member command | Embed listing your upcoming bookings with status emoji; buttons "View" and "Cancel" (with confirm). |
| `/print cancel <booking>` | Member command (autocomplete) | Confirmation message. |
| **Admin approval message** | New request (admin channel) | Embed: requester mention, thumbnail, slot, duration, filament, model ✓/✗, notes, hold expiry; buttons **Approve** (green), **Reject** (red, opens a modal for the reason), **Open in PrintQ** (link). After action: the embed updates to "Approved by @x" and the buttons are removed. |
| DM: Request received | After submit | "Your slot … is held until …" |
| DM: Approved / Rejected | After review | Approved: slot + "Add to calendar" link. Rejected: reason. |
| DM: Reminder | 24 h and 1 h before | Slot time, "Lab is open/closed now", rules link |
| DM: Lab opened | `/sccroom` opens on your booking day | "The lab is open; your slot starts at 2:00 PM" |
| DM: Ready for pickup | Marked finished | Pickup instructions |
| DM: Hold expired / No-show / Lab closed | System | Explanation + rebook link |

If a member has DMs disabled, PrintQ falls back to a mention in a `#printing` channel. Design one compact channel-message variant.

---

## 7. Content and tone

- **Friendly, short, student-facing.** "Your print is ready! Grab it from D224."
- Always state times in local time with day names ("Thu Oct 9, 2:00 PM"). Use relative time for countdowns ("in 3 h").
- **Never show other members' names on public pages.**

## 8. Out of scope for v1 (but leave room)

- Multiple printers: the schedule needs a printer switcher, so keep header space for it.
- Live printer telemetry (PrusaLink): progress %, nozzle temperature and a camera snapshot on `PrinterCard` and the session hero card. Show a disabled "Live status coming soon" placeholder.
- Microsoft (UFV) account linking on `/printing/login`.
