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

// custom_id format: printq:<action>:<bookingId>
export function printqCustomId(action: "approve" | "reject" | "cancel" | "view", bookingId: string) {
  return `${PRINTQ_CUSTOM_ID_PREFIX}${action}:${bookingId}`;
}

export function parsePrintqCustomId(customId: string) {
  const [, action, bookingId] = customId.split(":");
  return { action, bookingId };
}
