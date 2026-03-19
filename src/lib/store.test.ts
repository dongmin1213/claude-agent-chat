import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Chat, UIMessage, AppSettings } from "@/types/chat";

// =========================================
// localStorage mock
// =========================================

const internalStore: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((key: string) => internalStore[key] ?? null),
  setItem: vi.fn((key: string, val: string) => { internalStore[key] = val; }),
  removeItem: vi.fn((key: string) => { delete internalStore[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(internalStore)) delete internalStore[k]; }),
  get length() { return Object.keys(internalStore).length; },
  key: vi.fn(() => null),
};

// store.ts checks `typeof window === "undefined"` — we must define window
vi.stubGlobal("window", { localStorage: localStorageMock });
vi.stubGlobal("localStorage", localStorageMock);

// Mock crypto.randomUUID
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

// Import AFTER mocks set up
import {
  loadChats,
  saveChats,
  createChat,
  deleteChat,
  updateChatTitle,
  addMessageToChat,
  updateMessageInChat,
  updateMessageByToolUseId,
  setChatSessionId,
  updateChatCost,
  updateChatSettings,
  branchChat,
  exportChatAsMarkdown,
  exportChatAsJSON,
  generateTitle,
  loadAppSettings,
  saveAppSettings,
} from "./store";

function makeChat(overrides?: Partial<Chat>): Chat {
  return {
    id: "chat-1",
    title: "Test Chat",
    createdAt: 1000,
    updatedAt: 1000,
    sessionId: null,
    messages: [],
    model: "opus",
    cwd: "/test",
    settings: { systemPrompt: "", maxTurns: 0, maxBudgetUsd: 0 },
    costUsd: 0,
    durationMs: 0,
    ...overrides,
  };
}

function makeUserMsg(content = "hello", id = "msg-1"): UIMessage {
  return { id, role: "user", content, timestamp: 1000 } as UIMessage;
}

describe("store", () => {
  beforeEach(() => {
    // Clear internal store
    for (const k of Object.keys(internalStore)) delete internalStore[k];
    vi.clearAllMocks();
    uuidCounter = 0;
  });

  // =========================================
  // loadChats / saveChats
  // =========================================

  describe("loadChats", () => {
    it("returns empty array when nothing stored", () => {
      expect(loadChats()).toEqual([]);
    });

    it("loads stored chats", () => {
      const chat = makeChat();
      internalStore["claude-agent-chats"] = JSON.stringify([chat]);
      const loaded = loadChats();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("chat-1");
    });

    it("migrates old chats without settings", () => {
      const old = { id: "x", title: "t", createdAt: 0, updatedAt: 0, sessionId: null, messages: [], model: "opus", cwd: "/" };
      internalStore["claude-agent-chats"] = JSON.stringify([old]);
      const loaded = loadChats();
      expect(loaded[0].settings).toEqual({ systemPrompt: "", maxTurns: 0, maxBudgetUsd: 0 });
      expect(loaded[0].costUsd).toBe(0);
    });

    it("returns empty on corrupt JSON", () => {
      internalStore["claude-agent-chats"] = "not json";
      expect(loadChats()).toEqual([]);
    });
  });

  describe("saveChats", () => {
    it("returns true on success", () => {
      const ok = saveChats([makeChat()]);
      expect(ok).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it("strips base64 data URLs from images", () => {
      const chat = makeChat({
        messages: [
          { id: "m", role: "user", content: "hi", timestamp: 0, images: ["data:image/png;base64,xxx", "/path/to/img.png"] } as unknown as UIMessage,
        ],
      });
      saveChats([chat]);
      const saved = JSON.parse(internalStore["claude-agent-chats"]);
      expect(saved[0].messages[0].images).toEqual(["/path/to/img.png"]);
    });

    it("returns false on quota exceeded", () => {
      const original = localStorageMock.setItem.getMockImplementation();
      localStorageMock.setItem.mockImplementation(() => { throw new Error("QuotaExceeded"); });
      const ok = saveChats([makeChat()]);
      expect(ok).toBe(false);
      // Restore so subsequent tests work
      if (original) {
        localStorageMock.setItem.mockImplementation(original);
      } else {
        localStorageMock.setItem.mockImplementation((key: string, val: string) => { internalStore[key] = val; });
      }
    });
  });

  // =========================================
  // createChat
  // =========================================

  describe("createChat", () => {
    it("creates with defaults", () => {
      const chat = createChat();
      expect(chat.title).toBe("New Chat");
      expect(chat.model).toBe("opus");
      expect(chat.messages).toEqual([]);
      expect(chat.sessionId).toBeNull();
    });

    it("applies appSettings defaults", () => {
      const settings = { defaultSystemPrompt: "Be nice", defaultMaxTurns: 5, defaultMaxBudgetUsd: 1 } as AppSettings;
      const chat = createChat("sonnet", "/dir", settings);
      expect(chat.model).toBe("sonnet");
      expect(chat.cwd).toBe("/dir");
      expect(chat.settings.systemPrompt).toBe("Be nice");
      expect(chat.settings.maxTurns).toBe(5);
    });
  });

  // =========================================
  // CRUD functions
  // =========================================

  describe("deleteChat", () => {
    it("removes the chat", () => {
      const result = deleteChat([makeChat({ id: "a" }), makeChat({ id: "b" })], "a");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("b");
    });

    it("returns same array if id not found", () => {
      const chats = [makeChat()];
      expect(deleteChat(chats, "nonexistent")).toHaveLength(1);
    });
  });

  describe("updateChatTitle", () => {
    it("updates title", () => {
      const result = updateChatTitle([makeChat()], "chat-1", "New Title");
      expect(result[0].title).toBe("New Title");
    });
  });

  describe("addMessageToChat", () => {
    it("adds message to correct chat", () => {
      const msg = makeUserMsg();
      const result = addMessageToChat([makeChat()], "chat-1", msg);
      expect(result[0].messages).toHaveLength(1);
      expect(result[0].messages[0]).toBe(msg);
    });
  });

  describe("updateMessageInChat", () => {
    it("updates specific message", () => {
      const chat = makeChat({ messages: [makeUserMsg()] });
      const result = updateMessageInChat([chat], "chat-1", "msg-1", (m) => ({
        ...m,
        content: "updated",
      } as UIMessage));
      expect((result[0].messages[0] as { content: string }).content).toBe("updated");
    });
  });

  describe("updateMessageByToolUseId", () => {
    it("updates tool_use message by toolUseId", () => {
      const toolMsg: UIMessage = {
        id: "tm-1", role: "tool_use", toolName: "Read", toolUseId: "tu-1", input: {}, timestamp: 0, isRunning: true,
      } as unknown as UIMessage;
      const chat = makeChat({ messages: [toolMsg] });
      const result = updateMessageByToolUseId([chat], "chat-1", "tu-1", (m) => ({
        ...m,
        isRunning: false,
      } as UIMessage));
      expect((result[0].messages[0] as { isRunning: boolean }).isRunning).toBe(false);
    });
  });

  describe("setChatSessionId", () => {
    it("sets sessionId", () => {
      const result = setChatSessionId([makeChat()], "chat-1", "session-123");
      expect(result[0].sessionId).toBe("session-123");
    });
  });

  describe("updateChatCost", () => {
    it("accumulates cost and duration", () => {
      const chat = makeChat({ costUsd: 0.01, durationMs: 100 });
      const result = updateChatCost([chat], "chat-1", 0.05, 200);
      expect(result[0].costUsd).toBeCloseTo(0.06);
      expect(result[0].durationMs).toBe(300);
    });
  });

  describe("updateChatSettings", () => {
    it("updates model", () => {
      const result = updateChatSettings([makeChat()], "chat-1", { model: "haiku" });
      expect(result[0].model).toBe("haiku");
    });
  });

  // =========================================
  // branchChat
  // =========================================

  describe("branchChat", () => {
    it("creates branch with messages up to index", () => {
      const msgs: UIMessage[] = [
        makeUserMsg("first", "m1"),
        { id: "m2", role: "assistant", content: "reply", timestamp: 2000, isStreaming: false } as UIMessage,
        makeUserMsg("second", "m3"),
      ];
      const chat = makeChat({ messages: msgs });
      const result = branchChat([chat], "chat-1", 1);
      expect(result).not.toBeNull();
      expect(result!.chats).toHaveLength(2);
      expect(result!.chats[1].messages).toHaveLength(2);
      expect(result!.chats[1].title).toBe("Test Chat (branch)");
      expect(result!.chats[1].sessionId).toBeNull();
    });

    it("returns null for nonexistent source", () => {
      expect(branchChat([], "nope", 0)).toBeNull();
    });
  });

  // =========================================
  // Export
  // =========================================

  describe("exportChatAsMarkdown", () => {
    it("includes title and messages", () => {
      const chat = makeChat({
        messages: [
          makeUserMsg("hello", "u1"),
          { id: "a1", role: "assistant", content: "hi back", timestamp: 2000, isStreaming: false } as UIMessage,
        ],
      });
      const md = exportChatAsMarkdown(chat);
      expect(md).toContain("# Test Chat");
      expect(md).toContain("## User");
      expect(md).toContain("hello");
      expect(md).toContain("## Assistant");
      expect(md).toContain("hi back");
    });

    it("includes cost when > 0", () => {
      const chat = makeChat({ costUsd: 0.1234 });
      const md = exportChatAsMarkdown(chat);
      expect(md).toContain("$0.1234");
    });
  });

  describe("exportChatAsJSON", () => {
    it("returns valid JSON", () => {
      const chat = makeChat();
      const json = exportChatAsJSON(chat);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  // =========================================
  // generateTitle
  // =========================================

  describe("generateTitle", () => {
    it("returns short messages as-is", () => {
      expect(generateTitle("Short title")).toBe("Short title");
    });

    it("truncates long messages", () => {
      const long = "a".repeat(100);
      const title = generateTitle(long);
      expect(title.length).toBe(53);
      expect(title.endsWith("...")).toBe(true);
    });

    it("trims whitespace", () => {
      expect(generateTitle("  hello  ")).toBe("hello");
    });
  });

  // =========================================
  // App Settings
  // =========================================

  describe("loadAppSettings / saveAppSettings", () => {
    it("returns defaults when nothing stored", () => {
      const settings = loadAppSettings();
      expect(settings.theme).toBe("dark");
      expect(settings.mcpServers.length).toBeGreaterThan(0);
    });

    it("round-trips settings", () => {
      const custom: AppSettings = {
        theme: "light",
        mcpServers: [],
        defaultSystemPrompt: "test",
        defaultMaxTurns: 3,
        defaultMaxBudgetUsd: 2,
        wsScrcpyPath: "/ws",
        wsScrcpyPort: 9000,
      };
      saveAppSettings(custom);
      const loaded = loadAppSettings();
      expect(loaded.theme).toBe("light");
      expect(loaded.defaultSystemPrompt).toBe("test");
    });
  });
});
