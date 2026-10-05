import "server-only";
import {
  ApplicationCommandOptionType,
  ButtonStyle,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  TextInputStyle,
  type APIApplicationCommandInteractionDataOption,
  type APIEmbed,
  type APIInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { inBackground } from "../background";
import { AppLogoBlendedGreenDecimal } from "~/app/(site)/config";
import { transitionBooking } from "../bookings";
import { SLOT_HOLDING_STATUSES } from "../constants";
import { db, schema } from "../db/client";
import { isPrintQEnabled, siteOrigin } from "../env";
import { PrintQError } from "../errors";
import { formatCompactRange, formatDay, formatSlot, formatTime, STATUS_LABELS } from "../format";
import { getLabStatus } from "../lab-status";
import { onBookingTransition } from "../notify";
import { viewerForDiscordId } from "../profiles";
import { hasRole } from "../roles";
import { getActivePrinter, loadCalendar } from "../schedule";
import { PRINT_COMMAND_NAME, PRINTQ_CUSTOM_ID_PREFIX, parsePrintqCustomId } from "./commands";

export function isPrintQInteraction(interaction: APIInteraction): boolean {
  if (!isPrintQEnabled()) return false;
  switch (interaction.type) {
    case InteractionType.ApplicationCommand:
    case InteractionType.ApplicationCommandAutocomplete:
      return interaction.data.name === PRINT_COMMAND_NAME;
    case InteractionType.MessageComponent:
    case InteractionType.ModalSubmit:
      return interaction.data.custom_id.startsWith(PRINTQ_CUSTOM_ID_PREFIX);
    default:
      return false;
  }
}

const reply = (data: { content?: string; embeds?: APIEmbed[]; ephemeral?: boolean; components?: unknown[] }): APIInteractionResponse =>
  ({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content: data.content,
      embeds: data.embeds,
      components: data.components as never,
      flags: data.ephemeral === false ? undefined : MessageFlags.Ephemeral,
    },
  }) as APIInteractionResponse;

const siteButton = (label: string, path: string) => ({
  type: ComponentType.ActionRow,
  components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label, url: `${siteOrigin()}${path}` }],
});

const discordUserId = (interaction: APIInteraction) => interaction.member?.user.id ?? interaction.user?.id ?? "";

/**
 * Entry point called from app/(site)/api/webhooks/discord/interact/route.ts after
 * signature verification. Every response here is computed inline from Postgres,
 * well inside Discord's 3-second window; notifications run in `after()`.
 */
export async function handlePrintQInteraction(interaction: APIInteraction): Promise<NextResponse> {
  try {
    return NextResponse.json(await route(interaction));
  } catch (error) {
    const message = error instanceof PrintQError ? error.message : "Something went wrong. Try again on the website.";
    if (!(error instanceof PrintQError)) console.error("PrintQ interaction failed", error);
    return NextResponse.json(reply({ content: `:warning: ${message}` }));
  }
}

async function route(interaction: APIInteraction): Promise<unknown> {
  switch (interaction.type) {
    case InteractionType.ApplicationCommand: {
      if (interaction.data.type !== 1) break;
      const [sub] = (interaction.data.options ?? []) as APIApplicationCommandInteractionDataOption[];
      const options = sub && "options" in sub ? (sub.options ?? []) : [];
      const option = (name: string) => options.find((item) => item.name === name) as { value?: unknown } | undefined;
      if (sub?.name === "schedule") return scheduleReply(option("show_in_channel")?.value === true);
      if (sub?.name === "mine") return mineReply(discordUserId(interaction));
      if (sub?.name === "cancel") return cancelReply(discordUserId(interaction), String(option("booking")?.value ?? ""));
      break;
    }
    case InteractionType.ApplicationCommandAutocomplete:
      return { type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices: await cancellableChoices(discordUserId(interaction)) } };
    case InteractionType.MessageComponent: {
      const { action, bookingId } = parsePrintqCustomId(interaction.data.custom_id);
      if (action === "approve") return decide(interaction, bookingId, "approve");
      if (action === "reject") {
        // Ask for a reason first.
        return {
          type: InteractionResponseType.Modal,
          data: {
            custom_id: `${PRINTQ_CUSTOM_ID_PREFIX}rejectmodal:${bookingId}`,
            title: "Reject print request",
            components: [
              {
                type: ComponentType.ActionRow,
                components: [
                  {
                    type: ComponentType.TextInput,
                    custom_id: "reason",
                    label: "Reason (shown to the member)",
                    style: TextInputStyle.Short,
                    max_length: 200,
                    required: true,
                  },
                ],
              },
            ],
          },
        };
      }
      break;
    }
    case InteractionType.ModalSubmit: {
      const { action, bookingId } = parsePrintqCustomId(interaction.data.custom_id);
      if (action === "rejectmodal") {
        const field = interaction.data.components.flatMap((row) => ("components" in row ? row.components : [])).find((input) => input.custom_id === "reason");
        return decide(interaction, bookingId, "reject", field && "value" in field ? field.value : undefined);
      }
      break;
    }
  }
  return reply({ content: "Unknown PrintQ action." });
}

async function scheduleReply(showInChannel: boolean) {
  const printer = await getActivePrinter();
  const now = new Date();
  const calendar = await loadCalendar(printer.id, { start: now, end: new Date(now.getTime() + 7 * 86_400_000) });
  const lab = await getLabStatus();
  const busy = calendar.blocks.filter((block) => block.kind !== "closure");
  // The next two days with lab hours.
  const days = [...new Set(calendar.windows.map((window) => formatDay(window.start)))].slice(0, 2);
  const fields = days.map((day) => {
    const windows = calendar.windows.filter((window) => formatDay(window.start) === day);
    const lines: string[] = [];
    for (const window of windows) {
      let cursor = new Date(window.start).getTime();
      const end = new Date(window.end).getTime();
      const inWindow = busy
        .filter((block) => new Date(block.end).getTime() > cursor && new Date(block.start).getTime() < end)
        .sort((a, b) => a.start.localeCompare(b.start));
      for (const block of inWindow) {
        const blockStart = new Date(block.start).getTime();
        if (blockStart > cursor) lines.push(`🟢 Free ${formatCompactRange(new Date(cursor), new Date(blockStart))}`);
        lines.push(`${block.kind === "pending" ? "⏳ Pending" : block.kind === "printing" ? "🖨️ Printing" : block.kind === "maintenance" ? "🔧 Maintenance" : "⬛ Booked"} ${formatCompactRange(block.start, block.end)}`);
        cursor = Math.max(cursor, new Date(block.end).getTime());
      }
      if (cursor < end) lines.push(`🟢 Free ${formatCompactRange(new Date(cursor), new Date(end))}`);
    }
    return { name: day, value: lines.join("\n") || "No lab hours", inline: true };
  });
  const embed: APIEmbed = {
    title: `${printer.name} · schedule`,
    description: `${lab.open === true ? "🟢 Lab open" : lab.open === false ? "⚫ Lab closed" : "Lab status unknown"} · Pacific time · names are never shown`,
    color: AppLogoBlendedGreenDecimal,
    fields: fields.length ? fields : [{ name: "No lab hours", value: "Nothing scheduled in the next week." }],
  };
  return reply({ embeds: [embed], ephemeral: !showInChannel, components: [siteButton("Book on the website", "/printing/new")] });
}

async function mineReply(discordId: string) {
  const viewer = await viewerForDiscordId(discordId);
  if (!viewer) return reply({ content: "Sign in to PrintQ once with Discord to see your prints here.", components: [siteButton("Open PrintQ", "/printing/login")] });
  const rows = await db()
    .select({ id: schema.bookings.id, title: schema.bookings.title, status: schema.bookings.status, slot: schema.bookings.slot })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.ownerId, viewer.userId), inArray(schema.bookings.status, [...SLOT_HOLDING_STATUSES, "finished"])))
    .orderBy(asc(sql`lower(${schema.bookings.slot})`))
    .limit(10);
  if (rows.length === 0) return reply({ content: "You have no upcoming prints.", components: [siteButton("Book a print", "/printing/new")] });
  return reply({
    embeds: [
      {
        title: "Your upcoming prints",
        color: AppLogoBlendedGreenDecimal,
        description: rows.map((row) => `**${row.title ?? "Print"}** · ${formatSlot(row.slot.start, row.slot.end)} · ${STATUS_LABELS[row.status]}`).join("\n"),
      },
    ],
    components: [siteButton("My prints", "/printing/me")],
  });
}

async function cancellableChoices(discordId: string) {
  const viewer = await viewerForDiscordId(discordId);
  if (!viewer) return [];
  const rows = await db()
    .select({ id: schema.bookings.id, title: schema.bookings.title, slot: schema.bookings.slot })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.ownerId, viewer.userId), inArray(schema.bookings.status, ["pending", "approved"])))
    .orderBy(asc(sql`lower(${schema.bookings.slot})`))
    .limit(25);
  return rows.map((row) => ({ name: `${row.title ?? "Print"} · ${formatDay(row.slot.start)} ${formatTime(row.slot.start)}`.slice(0, 100), value: row.id }));
}

async function cancelReply(discordId: string, bookingId: string) {
  const viewer = await viewerForDiscordId(discordId);
  if (!viewer) throw new PrintQError("forbidden", "Sign in to PrintQ once with Discord first.");
  if (!/^[0-9a-f-]{36}$/.test(bookingId)) throw new PrintQError("bad_request", "Pick a booking from the list.");
  const [owned] = await db().select({ id: schema.bookings.id }).from(schema.bookings).where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.ownerId, viewer.userId))).limit(1);
  if (!owned) throw new PrintQError("not_found", "That isn't one of your bookings.");
  const booking = await transitionBooking({ ...viewer, role: "member" }, bookingId, "cancel");
  return reply({ content: `Cancelled **${booking.title ?? "your print"}** (${formatSlot(booking.slot.start, booking.slot.end)}).` });
}

/** Approve / reject from the admin-channel message. Updates the message in place. */
async function decide(interaction: APIInteraction, bookingId: string, action: "approve" | "reject", note?: string) {
  const viewer = await viewerForDiscordId(discordUserId(interaction));
  if (!viewer || !hasRole(viewer, "staff")) throw new PrintQError("forbidden", "Only PrintQ staff can review requests. Sign in to PrintQ first.");
  const booking = await transitionBooking(viewer, bookingId, action, note);
  inBackground(() => onBookingTransition(booking, action, viewer.userId, note));
  const verdict = action === "approve" ? `✅ Approved by <@${discordUserId(interaction)}>` : `❌ Rejected by <@${discordUserId(interaction)}>${note ? `: ${note}` : ""}`;
  const original = "message" in interaction && interaction.message ? interaction.message.embeds : [];
  return {
    type: InteractionResponseType.UpdateMessage,
    data: {
      embeds: [...original.slice(0, 1), { description: verdict, color: action === "approve" ? 0x52a040 : 0xf87171 }],
      components: [],
    },
  };
}
