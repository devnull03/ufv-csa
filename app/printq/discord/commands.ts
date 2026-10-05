import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const PRINT_COMMAND_NAME = "print";
export const PRINTQ_CUSTOM_ID_PREFIX = "printq:";

// `/print …` lives in the existing CSA Discord application next to `/sccroom`.
// scripts/discord-register-commands.ts merges this into the app's command list
// without touching any other command.
export const printCommand: RESTPostAPIChatInputApplicationCommandsJSONBody = {
  type: ApplicationCommandType.ChatInput,
  name: PRINT_COMMAND_NAME,
  description: "CSA 3D printer bookings",
  dm_permission: false,
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "schedule",
      description: "See when the 3D printer is free",
      options: [
        {
          type: ApplicationCommandOptionType.Boolean,
          name: "show_in_channel",
          description: "Post the answer for everyone instead of only you",
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "mine",
      description: "Your upcoming print bookings",
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "cancel",
      description: "Cancel one of your bookings",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "booking",
          description: "The booking to cancel",
          required: true,
          autocomplete: true,
        },
      ],
    },
  ],
};

export const PRINT_STAFF_COMMAND_NAME = "printstaff";

const WEEKDAY_CHOICES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((name, value) => ({ name, value }));

// Staff tools. Hidden from everyone by default ("0"); server admins allow the
// staff role under Server Settings → Integrations. The handler re-checks the
// role on every call regardless.
export const printStaffCommand: RESTPostAPIChatInputApplicationCommandsJSONBody = {
  type: ApplicationCommandType.ChatInput,
  name: PRINT_STAFF_COMMAND_NAME,
  description: "PrintQ staff tools",
  dm_permission: false,
  default_member_permissions: "0",
  options: [
    { type: ApplicationCommandOptionType.Subcommand, name: "pending", description: "Requests waiting for review" },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "booking",
      description: "Find a booking and act on it",
      options: [{ type: ApplicationCommandOptionType.String, name: "search", description: "Title, member or day", required: true, autocomplete: true }],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "close",
      description: "Close the lab or block the printer for a while",
      options: [
        { type: ApplicationCommandOptionType.String, name: "when", description: "e.g. Fri 12:30-4pm, Oct 9 all day", required: true, autocomplete: true },
        { type: ApplicationCommandOptionType.String, name: "reason", description: "Shown on the schedule", required: true, max_length: 120 },
        { type: ApplicationCommandOptionType.Boolean, name: "maintenance", description: "Printer maintenance (blocks running prints too)" },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "reopen",
      description: "Remove a closure",
      options: [{ type: ApplicationCommandOptionType.String, name: "closure", description: "The closure to remove", required: true, autocomplete: true }],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "hours",
      description: "See or change lab hours (admins)",
      options: [
        { type: ApplicationCommandOptionType.Integer, name: "day", description: "Weekday to change", choices: WEEKDAY_CHOICES },
        { type: ApplicationCommandOptionType.String, name: "hours", description: "e.g. 10:00-18:00, 10am-12, 1-5pm, or closed", max_length: 60 },
      ],
    },
    { type: ApplicationCommandOptionType.Subcommand, name: "board", description: "Re-post and pin the staff board" },
  ],
};

// custom_id format: printq:<action>:<bookingId | "board" | draft id | weekday>
export function printqCustomId(action: string, id: string) {
  return `${PRINTQ_CUSTOM_ID_PREFIX}${action}:${id}`;
}

export function parsePrintqCustomId(customId: string) {
  const [, action, bookingId] = customId.split(":");
  return { action, bookingId };
}
