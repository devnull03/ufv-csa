import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  BOOKING_PURPOSES,
  BOOKING_STATUSES,
  CLOSURE_KINDS,
  PRINTER_STATUSES,
  USER_ROLES,
} from "../constants";

// Everything PrintQ owns lives in its own Postgres schema so it can share a
// database with anything else on the server without name clashes.
export const printq = pgSchema("printq");

export interface TimeRange {
  start: Date;
  end: Date;
}

// Half-open [start, end) timestamptz range.
export const tstzrange = customType<{ data: TimeRange; driverData: string }>({
  dataType() {
    return "tstzrange";
  },
  toDriver(value) {
    return `[${value.start.toISOString()},${value.end.toISOString()})`;
  },
  fromDriver(value) {
    const match = /^[[(]"?([^",]+)"?,"?([^")]+)"?[)\]]$/.exec(value);
    if (!match) throw new Error(`Unexpected tstzrange value: ${value}`);
    return { start: new Date(match[1]), end: new Date(match[2]) };
  },
});

export const userRole = printq.enum("user_role", USER_ROLES);
export const bookingStatus = printq.enum("booking_status", BOOKING_STATUSES);
export const printerStatus = printq.enum("printer_status", PRINTER_STATUSES);
export const closureKind = printq.enum("closure_kind", CLOSURE_KINDS);
export const bookingPurpose = printq.enum("booking_purpose", BOOKING_PURPOSES);

// --- Better Auth core tables (field names required by the drizzle adapter) ---

export const user = printq.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Discord login only requests the `identify` scope; this is a placeholder.
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = printq.table("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = printq.table("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = printq.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- PrintQ domain ---

export const profiles = printq.table("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  discordId: text("discord_id").notNull().unique(),
  discordUsername: text("discord_username"),
  role: userRole("role").notNull().default("member"),
  isGuildMember: boolean("is_guild_member").notNull().default(false),
  hasVerifiedRole: boolean("has_verified_role").notNull().default(false),
  eligibilityCheckedAt: timestamp("eligibility_checked_at", { withTimezone: true }),
  bannedUntil: timestamp("banned_until", { withTimezone: true }),
  banReason: text("ban_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const printers = printq.table("printers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  model: text("model").notNull(),
  bedX: integer("bed_x_mm").notNull(),
  bedY: integer("bed_y_mm").notNull(),
  bedZ: integer("bed_z_mm").notNull(),
  status: printerStatus("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Weekly recurring windows in which a print may START. Local wall-clock time
// (PRINTQ_TIMEZONE). printerId null = applies to every printer.
export const labHours = printq.table("lab_hours", {
  id: uuid("id").primaryKey().defaultRandom(),
  printerId: uuid("printer_id").references(() => printers.id, { onDelete: "cascade" }),
  weekday: smallint("weekday").notNull(), // 0 = Sunday
  opensAt: time("opens_at").notNull(),
  closesAt: time("closes_at").notNull(),
});

export const closures = printq.table(
  "closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    printerId: uuid("printer_id").references(() => printers.id, { onDelete: "cascade" }),
    kind: closureKind("kind").notNull().default("closure"),
    during: tstzrange("during").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("closures_during_idx").using("gist", table.during)]
);

export const settings = printq.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});

export interface ParsedGcodeSummary {
  format: "gcode" | "bgcode";
  printSeconds: number | null;
  filamentGrams: number | null;
  filamentType: string | null;
  printerModel: string | null;
  layerHeightMm?: number | null;
  nozzleDiameterMm?: number | null;
  bbox: { x: number; y: number; z: number } | null;
  hasThumbnail: boolean;
}

export const uploads = printq.table("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  summary: jsonb("summary").$type<ParsedGcodeSummary>().notNull(),
  thumbnailKey: text("thumbnail_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  purgedAt: timestamp("purged_at", { withTimezone: true }),
});

// The bookings_no_overlap exclusion constraint lives in a custom migration
// (drizzle/0001_booking_exclusion.sql) because drizzle-kit cannot express it.
export const bookings = printq.table(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    printerId: uuid("printer_id")
      .notNull()
      .references(() => printers.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploads.id),
    slot: tstzrange("slot").notNull(),
    status: bookingStatus("status").notNull().default("pending"),
    title: text("title"),
    purpose: bookingPurpose("purpose"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    notes: text("notes"),
    modelUrl: text("model_url"),
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bookings_owner_idx").on(table.ownerId),
    index("bookings_status_idx").on(table.status),
  ]
);

export const bookingEvents = printq.table(
  "booking_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    fromStatus: bookingStatus("from_status"),
    toStatus: bookingStatus("to_status"),
    note: text("note"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("booking_events_booking_idx").on(table.bookingId)]
);
