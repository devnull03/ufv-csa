/**
 * Adds or updates the PrintQ `/print` and `/printstaff` commands on the existing
 * CSA Discord application WITHOUT touching any other command (e.g. /sccroom).
 *
 *   npx tsx --env-file=.env.local scripts/discord-register-commands.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/discord-register-commands.ts --apply   # write
 *
 * Commands are registered where /sccroom already lives (guild or global). Pass
 * --scope=guild or --scope=global to override.
 */
import { printCommand, printStaffCommand } from "../app/printq/discord/commands";

const applicationId = process.env.DISCORD_BOT_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_SERVER_ID;
const apply = process.argv.includes("--apply");
const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="))?.split("=")[1];

if (!applicationId || !token || !guildId) {
  console.error("DISCORD_BOT_ID, DISCORD_BOT_TOKEN and DISCORD_SERVER_ID must be set.");
  process.exit(1);
}

const api = (path: string, init: RequestInit = {}) =>
  fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json();
  });

type Command = { id: string; name: string; type?: number };

async function main() {
  const globalPath = `/applications/${applicationId}/commands`;
  const guildPath = `/applications/${applicationId}/guilds/${guildId}/commands`;
  const [globalCommands, guildCommands] = (await Promise.all([api(globalPath), api(guildPath)])) as [Command[], Command[]];

  console.log("Global commands:", globalCommands.map((command) => command.name).join(", ") || "(none)");
  console.log("Guild commands: ", guildCommands.map((command) => command.name).join(", ") || "(none)");

  const scope =
    scopeArg ?? (guildCommands.some((command) => command.name === "sccroom") ? "guild" : "global");
  const path = scope === "guild" ? guildPath : globalPath;
  for (const command of [printCommand, printStaffCommand]) {
    const existing = (scope === "guild" ? guildCommands : globalCommands).find((item) => item.name === command.name);
    console.log(`${existing ? "Update" : "Create"} /${command.name} in ${scope} scope.`);
    if (!apply) continue;
    // Single-command endpoints never delete other commands (unlike a bulk PUT).
    await (existing
      ? api(`${path}/${existing.id}`, { method: "PATCH", body: JSON.stringify(command) })
      : api(path, { method: "POST", body: JSON.stringify(command) }));
  }
  console.log(apply ? "Done." : "Dry run. Re-run with --apply to write.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
