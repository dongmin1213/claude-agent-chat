"use client";

import { useState, useEffect, memo } from "react";
import type { ChatSettings, AppSettings, McpServerConfig } from "@/types/chat";
import { useToast } from "./Toast";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Chat-level settings
  chatSettings: ChatSettings;
  onChatSettingsChange: (settings: ChatSettings) => void;
  // App-level settings
  appSettings: AppSettings;
  onAppSettingsChange: (settings: AppSettings) => void;
}

type Tab = "chat" | "mcp" | "device" | "app";

export default memo(function SettingsModal({
  isOpen,
  onClose,
  chatSettings,
  onChatSettingsChange,
  appSettings,
  onAppSettingsChange,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("chat");
  const [localChat, setLocalChat] = useState(chatSettings);
  const [localApp, setLocalApp] = useState(appSettings);
  const { addToast } = useToast();

  // MCP form state
  const [mcpName, setMcpName] = useState("");
  const [mcpType, setMcpType] = useState<"stdio" | "sse">("stdio");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  // MCP validation
  const [mcpErrors, setMcpErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setLocalChat(chatSettings);
    setLocalApp(appSettings);
  }, [chatSettings, appSettings, isOpen]);

  // Trap focus inside modal + ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = () => {
    onChatSettingsChange(localChat);
    onAppSettingsChange(localApp);
    addToast("success", "Settings saved");
    onClose();
  };

  // Immediate theme toggle — bypasses Save button for instant feedback
  const handleThemeToggle = () => {
    const newTheme = localApp.theme === "dark" ? "light" : "dark";
    setLocalApp((prev) => ({ ...prev, theme: newTheme }));
    document.documentElement.setAttribute("data-theme", newTheme);
    onAppSettingsChange({ ...appSettings, theme: newTheme });
  };

  const validateMcpForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!mcpName.trim()) errors.name = "Name is required";
    if (mcpType === "stdio" && !mcpCommand.trim()) errors.command = "Command is required";
    if (mcpType === "sse" && !mcpUrl.trim()) errors.url = "URL is required";
    if (mcpType === "sse" && mcpUrl.trim() && !mcpUrl.trim().match(/^https?:\/\//)) {
      errors.url = "Must start with http:// or https://";
    }
    setMcpErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const addMcpServer = () => {
    if (!validateMcpForm()) return;
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: mcpName.trim(),
      type: mcpType,
      command: mcpType === "stdio" ? mcpCommand.trim() : "",
      args: mcpType === "stdio" && mcpArgs.trim() ? mcpArgs.split(" ") : [],
      url: mcpType === "sse" ? mcpUrl.trim() : "",
      enabled: true,
    };
    setLocalApp((prev) => ({
      ...prev,
      mcpServers: [...prev.mcpServers, server],
    }));
    setMcpName("");
    setMcpType("stdio");
    setMcpCommand("");
    setMcpArgs("");
    setMcpUrl("");
    setMcpErrors({});
  };

  const removeMcpServer = (id: string) => {
    setLocalApp((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.filter((s) => s.id !== id),
    }));
  };

  const toggleMcpServer = (id: string) => {
    setLocalApp((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    }));
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "mcp", label: "MCP Servers" },
    { key: "device", label: "Device" },
    { key: "app", label: "Defaults" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="bg-bg-secondary border border-border rounded-lg w-[560px] max-w-[95vw] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
          <div className="flex items-center gap-3">
            {/* Dark mode toggle */}
            <button
              onClick={handleThemeToggle}
              className="flex items-center gap-2 group"
              aria-label={`Switch to ${localApp.theme === "dark" ? "light" : "dark"} mode`}
            >
              {/* Sun icon */}
              <svg
                width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5"
                className={`transition-colors duration-200 ${
                  localApp.theme === "light" ? "text-warning" : "text-text-muted"
                }`}
              >
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
              </svg>
              {/* Toggle track */}
              <div className="relative w-8 h-[18px] rounded-full bg-bg-primary border border-border transition-colors duration-200">
                <div
                  className={`absolute top-[2px] w-3 h-3 rounded-full transition-all duration-200 ${
                    localApp.theme === "dark"
                      ? "left-[3px] bg-accent"
                      : "left-[15px] bg-accent"
                  }`}
                />
              </div>
              {/* Moon icon */}
              <svg
                width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5"
                className={`transition-colors duration-200 ${
                  localApp.theme === "dark" ? "text-accent" : "text-text-muted"
                }`}
              >
                <path d="M13.5 8.5a5.5 5.5 0 0 1-7-7 6 6 0 1 0 7 7z" />
              </svg>
            </button>
            {/* Close button */}
            <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close settings">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5 overflow-x-auto" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              role="tab"
              aria-selected={tab === t.key}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.key
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4" role="tabpanel">
          {tab === "chat" && (
            <>
              {/* System Prompt */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  System Prompt (this chat)
                </label>
                <textarea
                  value={localChat.systemPrompt}
                  onChange={(e) => setLocalChat((p) => ({ ...p, systemPrompt: e.target.value }))}
                  placeholder="Custom instructions for this chat..."
                  className="w-full h-28 bg-bg-primary border border-border rounded-md px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent"
                />
              </div>
            </>
          )}

          {tab === "mcp" && (
            <>
              <p className="text-xs text-text-muted">
                Add MCP servers to extend Claude with external tools (browser, database, etc.)
              </p>
              {/* Server List */}
              {localApp.mcpServers.length > 0 && (
                <div className="space-y-2">
                  {localApp.mcpServers.map((server) => (
                    <div key={server.id} className="flex items-center gap-2 bg-bg-primary border border-border rounded-md px-3 py-2">
                      <button
                        onClick={() => toggleMcpServer(server.id)}
                        className="flex-shrink-0"
                        aria-label={server.enabled ? `Disable ${server.name}` : `Enable ${server.name}`}
                      >
                        <div className={`w-3.5 h-3.5 rounded border ${server.enabled ? "bg-accent border-accent" : "border-border"} flex items-center justify-center`}>
                          {server.enabled && (
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.5">
                              <path d="M1.5 4L3 5.5L6.5 2" />
                            </svg>
                          )}
                        </div>
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-text-primary truncate">
                          {server.name}
                          <span className="ml-1.5 text-[9px] text-text-muted font-normal uppercase">{server.type || "stdio"}</span>
                        </div>
                        <div className="text-[10px] text-text-muted truncate">
                          {server.type === "sse" ? server.url : `${server.command} ${server.args.join(" ")}`}
                        </div>
                      </div>
                      <button
                        onClick={() => removeMcpServer(server.id)}
                        className="text-text-muted hover:text-red-400 flex-shrink-0"
                        aria-label={`Remove ${server.name}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M3 3l6 6M9 3l-6 6" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Add new */}
              <div className="bg-bg-primary border border-border rounded-md p-3 space-y-2">
                <div className="text-xs font-medium text-text-secondary">Add Server</div>
                <div>
                  <input
                    value={mcpName}
                    onChange={(e) => { setMcpName(e.target.value); setMcpErrors((p) => ({ ...p, name: "" })); }}
                    placeholder="Name (e.g. playwright)"
                    className={`w-full bg-bg-secondary border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent ${
                      mcpErrors.name ? "border-error" : "border-border"
                    }`}
                    aria-invalid={!!mcpErrors.name}
                  />
                  {mcpErrors.name && <p className="text-[10px] text-error mt-0.5">{mcpErrors.name}</p>}
                </div>
                {/* Type toggle */}
                <div className="flex gap-1">
                  {(["stdio", "sse"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => { setMcpType(t); setMcpErrors({}); }}
                      className={`px-2.5 py-0.5 text-[10px] rounded border transition-colors ${
                        mcpType === t
                          ? "border-accent text-accent bg-accent/10"
                          : "border-border text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
                {mcpType === "stdio" ? (
                  <>
                    <div>
                      <input
                        value={mcpCommand}
                        onChange={(e) => { setMcpCommand(e.target.value); setMcpErrors((p) => ({ ...p, command: "" })); }}
                        placeholder="Command (e.g. npx)"
                        className={`w-full bg-bg-secondary border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent ${
                          mcpErrors.command ? "border-error" : "border-border"
                        }`}
                        aria-invalid={!!mcpErrors.command}
                      />
                      {mcpErrors.command && <p className="text-[10px] text-error mt-0.5">{mcpErrors.command}</p>}
                    </div>
                    <input
                      value={mcpArgs}
                      onChange={(e) => setMcpArgs(e.target.value)}
                      placeholder="Args (space-separated, e.g. @playwright/mcp@latest)"
                      className="w-full bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                    />
                  </>
                ) : (
                  <div>
                    <input
                      value={mcpUrl}
                      onChange={(e) => { setMcpUrl(e.target.value); setMcpErrors((p) => ({ ...p, url: "" })); }}
                      placeholder="URL (e.g. http://localhost:3847/sse)"
                      className={`w-full bg-bg-secondary border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent ${
                        mcpErrors.url ? "border-error" : "border-border"
                      }`}
                      aria-invalid={!!mcpErrors.url}
                    />
                    {mcpErrors.url && <p className="text-[10px] text-error mt-0.5">{mcpErrors.url}</p>}
                  </div>
                )}
                <button
                  onClick={addMcpServer}
                  className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/80 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </>
          )}

          {tab === "device" && (
            <>
              <p className="text-xs text-text-muted mb-2">
                Configure ws-scrcpy for Android device mirroring in Preview panel.
              </p>
              {/* ws-scrcpy Path */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  ws-scrcpy Directory Path
                </label>
                <input
                  value={localApp.wsScrcpyPath}
                  onChange={(e) => setLocalApp((p) => ({ ...p, wsScrcpyPath: e.target.value }))}
                  placeholder="e.g. C:\Users\you\ws-scrcpy"
                  className="w-full bg-bg-primary border border-border rounded-md px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Path to cloned ws-scrcpy repository (must have node_modules installed)
                </p>
              </div>
              {/* ws-scrcpy Port */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  ws-scrcpy Port
                </label>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={localApp.wsScrcpyPort}
                  onChange={(e) => setLocalApp((p) => ({ ...p, wsScrcpyPort: Number(e.target.value) || 8000 }))}
                  className="w-32 bg-bg-primary border border-border rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              {/* Setup guide */}
              <div className="bg-bg-primary border border-border rounded-md p-3 space-y-1.5">
                <div className="text-xs font-medium text-text-secondary">Setup Guide</div>
                <div className="text-[10px] text-text-muted space-y-1 font-mono">
                  <p>1. git clone https://github.com/nickytonline/ws-scrcpy</p>
                  <p>2. cd ws-scrcpy</p>
                  <p>3. npm install</p>
                  <p>4. npm run build</p>
                  <p>5. Set the path above to the ws-scrcpy directory</p>
                </div>
                <p className="text-[10px] text-text-muted mt-2">
                  Requires: ADB installed, Android device connected (USB debugging ON) or MuMu/Emulator running.
                </p>
              </div>
            </>
          )}

          {tab === "app" && (
            <>
              {/* Default System Prompt */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Default System Prompt <span className="text-text-muted">(for new chats)</span>
                </label>
                <textarea
                  value={localApp.defaultSystemPrompt}
                  onChange={(e) => setLocalApp((p) => ({ ...p, defaultSystemPrompt: e.target.value }))}
                  placeholder="Default instructions for all new chats..."
                  className="w-full h-20 bg-bg-primary border border-border rounded-md px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-text-muted hover:text-text-secondary border border-border rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent/80"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
});
