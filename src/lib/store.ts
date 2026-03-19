import type { Chat, UIMessage, AppSettings } from "@/types/chat";
import { DEFAULT_APP_SETTINGS, DEFAULT_MCP_SERVERS } from "@/types/chat";

const STORAGE_KEY = "claude-agent-chats";
const APP_SETTINGS_KEY = "claude-agent-app-settings";

// =========================================
// Persistence
// =========================================

export function loadChats(): Chat[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const chats: Chat[] = raw ? JSON.parse(raw) : [];
    // Migrate old chats without new fields
    return chats.map((c) => ({
      ...c,
      settings: c.settings || { systemPrompt: "", maxTurns: 0, maxBudgetUsd: 0 },
      costUsd: c.costUsd || 0,
      durationMs: c.durationMs || 0,
      inputTokens: c.inputTokens || 0,
      outputTokens: c.outputTokens || 0,
      turnCount: c.turnCount || 0,
    }));
  } catch {
    return [];
  }
}

/** Returns true if saved OK, false if quota exceeded (fallback used or failed entirely). */
export function saveChats(chats: Chat[]): boolean {
  if (typeof window === "undefined") return true;
  // Strip any remaining base64 data URLs from images to prevent localStorage overflow
  const sanitized = chats.map((chat) => ({
    ...chat,
    messages: chat.messages.map((msg) => {
      const images = (msg as { images?: string[] }).images;
      if (images && images.some((s) => s.startsWith("data:"))) {
        // Filter out base64 data URLs, keep only file paths
        const pathsOnly = images.filter((s) => !s.startsWith("data:"));
        if (pathsOnly.length > 0) {
          return { ...msg, images: pathsOnly };
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { images: _removed, ...rest } = msg as unknown as Record<string, unknown>;
        return rest as unknown as UIMessage;
      }
      return msg;
    }),
  }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    return true;
  } catch {
    // localStorage quota exceeded — try saving without images at all
    const noImages = sanitized.map((chat) => ({
      ...chat,
      messages: chat.messages.map((msg) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { images: _img, ...rest } = msg as unknown as Record<string, unknown>;
        return rest as unknown as UIMessage;
      }),
    }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(noImages));
      return false; // Saved but with degraded data
    } catch {
      return false; // Complete failure
    }
  }
}

/**
 * Merge-save a single chat into localStorage without overwriting other chats.
 * Used by chat windows to avoid race conditions with the main window.
 */
export function saveSingleChat(chatId: string, chats: Chat[]): boolean {
  if (typeof window === "undefined") return true;
  const updatedChat = chats.find((c) => c.id === chatId);
  if (!updatedChat) return true;

  try {
    // Read the CURRENT full list from localStorage (not our stale state)
    const raw = localStorage.getItem(STORAGE_KEY);
    const current: Chat[] = raw ? JSON.parse(raw) : [];

    // Replace only the target chat, keep everything else as-is
    const idx = current.findIndex((c) => c.id === chatId);
    if (idx >= 0) {
      current[idx] = updatedChat;
    } else {
      current.push(updatedChat);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_APP_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    const saved = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) } as AppSettings;

    // Migrate: ensure default MCP servers exist
    for (const defaultServer of DEFAULT_MCP_SERVERS) {
      const exists = saved.mcpServers.some(
        (s) => s.id === defaultServer.id || s.name === defaultServer.name
      );
      if (!exists) {
        saved.mcpServers.push({ ...defaultServer });
      }
    }

    // Migrate: add type/url fields to old MCP server configs
    saved.mcpServers = saved.mcpServers.map((s) => ({
      ...s,
      type: s.type || "stdio",
      url: s.url || "",
    }));

    return saved;
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
}

// =========================================
// Chat CRUD
// =========================================

export function createChat(model = "opus", cwd = "", appSettings?: AppSettings): Chat {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionId: null,
    messages: [],
    model,
    cwd,
    settings: {
      systemPrompt: appSettings?.defaultSystemPrompt || "",
      maxTurns: appSettings?.defaultMaxTurns || 0,
      maxBudgetUsd: appSettings?.defaultMaxBudgetUsd || 0,
    },
    costUsd: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    turnCount: 0,
  };
}

export function updateChatSettings(
  chats: Chat[],
  chatId: string,
  settings: Partial<Pick<Chat, "model" | "cwd" | "settings">>
): Chat[] {
  return chats.map((c) =>
    c.id === chatId ? { ...c, ...settings, updatedAt: Date.now() } : c
  );
}

export function deleteChat(chats: Chat[], chatId: string): Chat[] {
  return chats.filter((c) => c.id !== chatId);
}

export function updateChatTitle(
  chats: Chat[],
  chatId: string,
  title: string
): Chat[] {
  return chats.map((c) =>
    c.id === chatId ? { ...c, title, updatedAt: Date.now() } : c
  );
}

export function addMessageToChat(
  chats: Chat[],
  chatId: string,
  message: UIMessage
): Chat[] {
  return chats.map((c) =>
    c.id === chatId
      ? { ...c, messages: [...c.messages, message], updatedAt: Date.now() }
      : c
  );
}

export function updateMessageInChat(
  chats: Chat[],
  chatId: string,
  messageId: string,
  updater: (msg: UIMessage) => UIMessage
): Chat[] {
  return chats.map((c) =>
    c.id === chatId
      ? {
          ...c,
          messages: c.messages.map((m) =>
            m.id === messageId ? updater(m) : m
          ),
          updatedAt: Date.now(),
        }
      : c
  );
}

export function updateMessageByToolUseId(
  chats: Chat[],
  chatId: string,
  toolUseId: string,
  updater: (msg: UIMessage) => UIMessage
): Chat[] {
  return chats.map((c) =>
    c.id === chatId
      ? {
          ...c,
          messages: c.messages.map((m) =>
            m.role === "tool_use" &&
            (m as { toolUseId: string }).toolUseId === toolUseId
              ? updater(m)
              : m
          ),
          updatedAt: Date.now(),
        }
      : c
  );
}

export function setChatSessionId(
  chats: Chat[],
  chatId: string,
  sessionId: string
): Chat[] {
  return chats.map((c) =>
    c.id === chatId ? { ...c, sessionId, updatedAt: Date.now() } : c
  );
}

export function updateChatCost(
  chats: Chat[],
  chatId: string,
  costUsd: number,
  durationMs: number,
  inputTokens?: number,
  outputTokens?: number,
  turnCount?: number
): Chat[] {
  return chats.map((c) =>
    c.id === chatId
      ? {
          ...c,
          costUsd: c.costUsd + costUsd,
          durationMs: c.durationMs + durationMs,
          inputTokens: (c.inputTokens || 0) + (inputTokens || 0),
          outputTokens: (c.outputTokens || 0) + (outputTokens || 0),
          turnCount: (c.turnCount || 0) + (turnCount || 0),
          updatedAt: Date.now(),
        }
      : c
  );
}

// =========================================
// Reorder Chats (drag & drop)
// =========================================

export function reorderChats(
  chats: Chat[],
  chatId: string,
  newIndex: number
): Chat[] {
  // Sort by current order to get display order
  const sorted = [...chats].sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    return b.createdAt - a.createdAt;
  });

  const oldIndex = sorted.findIndex((c) => c.id === chatId);
  if (oldIndex === -1 || oldIndex === newIndex) return chats;

  // Move item
  const [moved] = sorted.splice(oldIndex, 1);
  sorted.splice(newIndex, 0, moved);

  // Reassign order values
  const orderMap = new Map<string, number>();
  sorted.forEach((c, i) => orderMap.set(c.id, i));

  return chats.map((c) => ({ ...c, order: orderMap.get(c.id) ?? 0 }));
}

// =========================================
// Unread Count
// =========================================

export function incrementUnread(chats: Chat[], chatId: string): Chat[] {
  return chats.map((c) =>
    c.id === chatId
      ? { ...c, unreadCount: (c.unreadCount || 0) + 1 }
      : c
  );
}

export function resetUnread(chats: Chat[], chatId: string): Chat[] {
  return chats.map((c) =>
    c.id === chatId && (c.unreadCount || 0) > 0
      ? { ...c, unreadCount: 0 }
      : c
  );
}

// =========================================
// Toggle Chat Pin (sidebar)
// =========================================

export function toggleChatPin(chats: Chat[], chatId: string): Chat[] {
  return chats.map((c) =>
    c.id === chatId
      ? { ...c, pinned: !c.pinned, updatedAt: Date.now() }
      : c
  );
}

// =========================================
// Toggle Pin Message
// =========================================

export function togglePinMessage(
  chats: Chat[],
  chatId: string,
  messageId: string
): Chat[] {
  return chats.map((c) =>
    c.id === chatId
      ? {
          ...c,
          messages: c.messages.map((m) =>
            m.id === messageId ? { ...m, pinned: !m.pinned } : m
          ),
          updatedAt: Date.now(),
        }
      : c
  );
}

// =========================================
// Branch Chat
// =========================================

export function branchChat(
  chats: Chat[],
  sourceChatId: string,
  messageIndex: number
): { chats: Chat[]; newChatId: string } | null {
  const source = chats.find((c) => c.id === sourceChatId);
  if (!source) return null;

  const newChat: Chat = {
    id: crypto.randomUUID(),
    title: source.title + " (branch)",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionId: null, // New session for branch
    messages: source.messages.slice(0, messageIndex + 1),
    model: source.model,
    cwd: source.cwd,
    settings: { ...source.settings },
    costUsd: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    turnCount: 0,
    branchedFrom: { chatId: sourceChatId, messageIndex },
  };

  return { chats: [...chats, newChat], newChatId: newChat.id };
}

// =========================================
// Export
// =========================================

export function exportChatAsMarkdown(chat: Chat): string {
  const lines: string[] = [];
  lines.push(`# ${chat.title}`);
  lines.push(`> Model: ${chat.model} | CWD: ${chat.cwd}`);
  lines.push(`> Created: ${new Date(chat.createdAt).toLocaleString()}`);
  if (chat.inputTokens > 0 || chat.outputTokens > 0) {
    const total = chat.inputTokens + chat.outputTokens;
    lines.push(`> Tokens: ${total.toLocaleString()} (${chat.inputTokens.toLocaleString()} in / ${chat.outputTokens.toLocaleString()} out) | Turns: ${chat.turnCount}`);
  } else if (chat.costUsd > 0) {
    lines.push(`> Cost: $${chat.costUsd.toFixed(4)}`);
  }
  lines.push("");

  for (const msg of chat.messages) {
    switch (msg.role) {
      case "user":
        lines.push(`## User\n\n${msg.content}\n`);
        break;
      case "assistant":
        lines.push(`## Assistant\n\n${msg.content}\n`);
        break;
      case "tool_use":
        lines.push(`### Tool: ${msg.toolName}\n\n\`\`\`json\n${JSON.stringify(msg.input, null, 2)}\n\`\`\`\n`);
        break;
      case "tool_result":
        lines.push(`### Result${msg.isError ? " (Error)" : ""}\n\n\`\`\`\n${msg.content}\n\`\`\`\n`);
        break;
      case "error":
        lines.push(`### Error\n\n${msg.content}\n`);
        break;
    }
  }

  return lines.join("\n");
}

export function exportChatAsJSON(chat: Chat): string {
  return JSON.stringify(chat, null, 2);
}

// =========================================
// Utilities
// =========================================

export function generateTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  return trimmed.length > 50 ? trimmed.slice(0, 50) + "..." : trimmed;
}
