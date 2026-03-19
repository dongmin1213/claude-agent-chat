import { describe, it, expect } from "vitest";
import { parseSlashCommand, filterCommands, SLASH_COMMANDS } from "./slash-commands";

describe("parseSlashCommand", () => {
  it("parses /clear", () => {
    const result = parseSlashCommand("/clear");
    expect(result).toEqual({ command: "clear", args: "" });
  });

  it("parses /download with path containing spaces", () => {
    const result = parseSlashCommand("/download C:\\my folder\\app.apk");
    expect(result).toEqual({ command: "download", args: "C:\\my folder\\app.apk" });
  });

  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
  });

  it("returns null for unknown command", () => {
    expect(parseSlashCommand("/unknown")).toBeNull();
  });

  it("handles /compact with instructions", () => {
    const result = parseSlashCommand("/compact focus on code changes");
    expect(result).toEqual({ command: "compact", args: "focus on code changes" });
  });

  it("trims whitespace", () => {
    const result = parseSlashCommand("  /help  ");
    expect(result).toEqual({ command: "help", args: "" });
  });
});

describe("filterCommands", () => {
  it("returns all commands for /", () => {
    const result = filterCommands("/");
    expect(result).toHaveLength(SLASH_COMMANDS.length);
  });

  it("filters by prefix", () => {
    const result = filterCommands("/cl");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("clear");
  });

  it("filters case-insensitively", () => {
    const result = filterCommands("/CL");
    expect(result).toHaveLength(1);
  });

  it("returns empty for non-slash input", () => {
    expect(filterCommands("hello")).toEqual([]);
  });

  it("returns matching commands for /co", () => {
    const result = filterCommands("/co");
    expect(result.some((c) => c.name === "compact")).toBe(true);
  });

  it("stops filtering after space (command typed fully)", () => {
    // "/clear some args" → prefix is "/clear", should match clear
    const result = filterCommands("/clear");
    expect(result.some((c) => c.name === "clear")).toBe(true);
  });
});
