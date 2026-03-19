// =========================================
// Slash Commands Definition & Parsing (extracted for testability)
// =========================================

export interface SlashCommand {
  name: string;
  description: string;
  args?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "clear", description: "Clear all messages in current chat" },
  { name: "compact", description: "Compress conversation context (keeps session)", args: "<instructions?>" },
  { name: "download", description: "Download a file from server", args: "<file path>" },
  { name: "help", description: "Show available commands" },
  { name: "export", description: "Export chat (md/json)", args: "<format?>" },
];

/**
 * Parse a slash command from input text.
 * Returns { command, args } if valid, null otherwise.
 */
export function parseSlashCommand(input: string): { command: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.split(/\s+/);
  const cmdName = parts[0].slice(1); // remove leading /
  if (!cmdName) return null;

  const cmd = SLASH_COMMANDS.find((c) => c.name === cmdName);
  if (!cmd) return null;

  const args = parts.slice(1).join(" ");
  return { command: cmdName, args };
}

/**
 * Filter commands for autocomplete based on current input.
 */
export function filterCommands(input: string): SlashCommand[] {
  if (!input.startsWith("/")) return [];
  const prefix = input.split(" ")[0].toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => `/${cmd.name}`.toLowerCase().startsWith(prefix));
}
