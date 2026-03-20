"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type {
  Chat,
  UIMessage,
  StreamEvent,
  AssistantTextMessage,
  ToolUseMessage,
  ToolResultMessage,
  ErrorMessage,
  PlanApprovalMessage,
  AskUserMessage,
  AppSettings,
  Attachment,
} from "@/types/chat";
import {
  loadChats,
  saveChats,
  saveSingleChat,
  createChat,
  deleteChat as deleteChatFromList,
  addMessageToChat,
  updateMessageInChat,
  updateMessageByToolUseId,
  setChatSessionId,
  updateChatTitle,
  updateChatSettings,
  updateChatCost,
  branchChat,
  exportChatAsMarkdown,
  exportChatAsJSON,
  generateTitle,
  loadAppSettings,
  saveAppSettings,
  reorderChats,
  togglePinMessage,
  incrementUnread,
  resetUnread,
  toggleChatPin,
} from "@/lib/store";
import Sidebar from "@/components/Sidebar";
import ChatArea from "@/components/ChatArea";
import MessageInput from "@/components/MessageInput";
import { SLASH_COMMANDS } from "@/lib/slash-commands";
import TopBar from "@/components/TopBar";
import SettingsModal from "@/components/SettingsModal";
import TerminalPanel from "@/components/TerminalPanel";
import { ToastProvider, useToast } from "@/components/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";

// =========================================
// Window Mode Detection (Electron multi-window)
// =========================================

type WindowMode = "browser" | "main" | "chat";

function useWindowMode(): { mode: WindowMode; chatId: string | null } {
  const [windowMode, setWindowMode] = useState<{ mode: WindowMode; chatId: string | null }>({ mode: "browser", chatId: null });

  useEffect(() => {
    const isElectron = typeof window !== "undefined" && !!window.electronAPI;
    if (!isElectron) {
      setWindowMode({ mode: "browser", chatId: null });
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (mode === "main") {
      setWindowMode({ mode: "main", chatId: null });
    } else if (mode === "chat") {
      setWindowMode({ mode: "chat", chatId: params.get("chatId") });
    } else {
      setWindowMode({ mode: "browser", chatId: null });
    }
  }, []);

  return windowMode;
}

// =========================================
// NDJSON Stream Reader
// =========================================

const STREAM_TOTAL_TIMEOUT = 30 * 60 * 1000; // 30 minutes max (agents can run long tasks)
const STREAM_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes no activity

async function readNDJSONStream(
  response: Response,
  onEvent: (event: StreamEvent) => void
) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const startTime = Date.now();
  let lastActivity = Date.now();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    while (true) {
      // Check total timeout
      if (Date.now() - startTime > STREAM_TOTAL_TIMEOUT) {
        reader.cancel();
        throw new Error("Stream timeout: response took too long (30 min limit)");
      }

      // Race between read and idle timeout (with proper cleanup)
      const readPromise = reader.read();
      const idlePromise = new Promise<never>((_, reject) => {
        const remaining = STREAM_IDLE_TIMEOUT - (Date.now() - lastActivity);
        idleTimer = setTimeout(
          () => reject(new Error("Stream idle: no data for 10 minutes")),
          Math.max(remaining, 0)
        );
      });

      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([readPromise, idlePromise]);
      } finally {
        // Always clear idle timer to prevent unhandled rejection
        if (idleTimer !== null) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      }

      const { done, value } = result;
      if (done) break;

      lastActivity = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line) as StreamEvent;
            onEvent(event);
          } catch {
            // Skip malformed lines
          }
        }
      }
    }

    // Remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer) as StreamEvent;
        onEvent(event);
      } catch {
        // Skip
      }
    }
  } catch (err) {
    // Silently handle stream abort/disconnect errors
    // AbortError, network errors, and Event objects can be thrown here
    if (err instanceof Error && err.name !== "AbortError") {
      throw err;
    }
    // Non-Error objects (like Event) are silently ignored
  } finally {
    // Ensure timer cleanup on exit
    if (idleTimer !== null) clearTimeout(idleTimer);
  }
}

// =========================================
// Download helper
// =========================================

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// =========================================
// Main Page Component
// =========================================

export default function Home() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <HomeInner />
      </ToastProvider>
    </ErrorBoundary>
  );
}

function HomeInner() {
  const { addToast, addToastWithAction } = useToast();
  const { mode: windowMode, chatId: windowChatId } = useWindowMode();
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loadingChatIds, setLoadingChatIds] = useState<Set<string>>(new Set());
  const [streamConnectedChatIds, setStreamConnectedChatIds] = useState<Set<string>>(new Set());
  const [statusMessages, setStatusMessages] = useState<Map<string, string>>(new Map());
  const loadingStartTimesRef = useRef<Map<string, number>>(new Map());
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [defaultCwd, setDefaultCwd] = useState("");
  // (explorer/preview removed — not used)
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(35); // percentage of chat column
  const isTermDraggingRef = useRef(false);
  const chatColumnRef = useRef<HTMLDivElement>(null);

  // App settings
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", appSettings.theme);
  }, [appSettings.theme]);

  // Request desktop notification permission on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Save app settings
  const handleAppSettingsChange = useCallback((settings: AppSettings) => {
    setAppSettings(settings);
    saveAppSettings(settings);
  }, []);

  // Initialize default CWD (prefer Desktop)
  useEffect(() => {
    if (!defaultCwd) {
      fetch("/api/files").then(r => r.json()).then(d => {
        if (d.desktopPath) setDefaultCwd(d.desktopPath);
        else if (d.cwd) setDefaultCwd(d.cwd);
      }).catch(() => {});
    }
  }, [defaultCwd]);

  // =========================================
  // Keyboard Shortcuts
  // =========================================
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+N: New chat
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        handleNewChat();
      }
      // Ctrl+K: Focus search (sidebar auto-opens)
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (sidebarCollapsed) setSidebarCollapsed(false);
        setSidebarOpen(true);
        setTimeout(() => {
          const input = document.querySelector('aside input[placeholder*="Search"]') as HTMLInputElement;
          input?.focus();
        }, 100);
      }
      // Ctrl+,: Settings
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((p) => !p);
      }
      // Ctrl+Shift+E: Export current chat as markdown
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "E") {
        e.preventDefault();
        if (activeChatId) handleExportChat(activeChatId, "md");
      }
      // Ctrl+`: Toggle terminal
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setTerminalOpen((p) => !p);
      }
      // Ctrl+F: In-conversation search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setChatSearchOpen((p) => !p);
      }
      // Escape: Close modals first, then close/hide window (Electron)
      if (e.key === "Escape") {
        // Skip if typing in input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        // Priority: close modals/search first
        if (chatSearchOpen) { setChatSearchOpen(false); return; }
        if (settingsOpen) { setSettingsOpen(false); return; }
        // Electron mode: hide window (like KakaoTalk)
        if (typeof window !== "undefined" && (window as unknown as { electronAPI?: { close: () => void } }).electronAPI) {
          (window as unknown as { electronAPI: { close: () => void } }).electronAPI.close();
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarCollapsed, settingsOpen, activeChatId, chatSearchOpen]);

  // Drag resizer for terminal panel (horizontal)
  const handleTermMouseDown = useCallback(() => {
    isTermDraggingRef.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      if (!isTermDraggingRef.current || !chatColumnRef.current) return;
      const rect = chatColumnRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const pct = ((rect.height - y) / rect.height) * 100;
      setTerminalHeight(Math.min(70, Math.max(15, pct)));
    };

    const handleMouseUp = () => {
      isTermDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  // Per-chat stream state and abort controllers
  const streamStateRef = useRef<Map<string, {
    assistantId: string | null;
    toolUseId: string | null;
    toolInputBuffer: Record<string, string>;
    toolUseMessageIdMap: Map<string, string>;
  }>>(new Map());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  // Track backend stream IDs for abort endpoint (chatId → streamId)
  const streamIdsRef = useRef<Map<string, string>>(new Map());
  // Queue messages sent while AI is streaming — auto-sent after stream completes
  const pendingMessagesRef = useRef<Map<string, { fullMessage: string; displayText: string; images?: string[] }[]>>(new Map());
  const activeChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // Load chats from localStorage on mount
  useEffect(() => {
    const loaded = loadChats();
    setChats(loaded);
    if (windowMode === "chat" && windowChatId) {
      // Chat window mode: always use the chatId from URL
      setActiveChatId(windowChatId);
      activeChatIdRef.current = windowChatId;
    } else if (windowMode !== "main" && loaded.length > 0) {
      // Browser mode: select first chat
      setActiveChatId(loaded[0].id);
    }
    // Main mode: no active chat needed (list only)
  }, [windowMode, windowChatId]);

  // Reset unread when window becomes visible (Electron hide/show)
  useEffect(() => {
    const handler = () => {
      if (!document.hidden && activeChatIdRef.current) {
        setChats((prev) => resetUnread(prev, activeChatIdRef.current!));
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Save to localStorage when chats change (debounced during streaming)
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const quotaWarned = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef(false);

  const doSave = useCallback(() => {
    const currentChats = chatsRef.current;
    if (currentChats.length === 0) return;
    let ok: boolean;
    if (windowMode === "chat" && windowChatId) {
      ok = saveSingleChat(windowChatId, currentChats);
    } else {
      ok = saveChats(currentChats);
    }
    if (!ok && !quotaWarned.current) {
      quotaWarned.current = true;
      addToast("warning", "Storage almost full. Some data may not be saved. Consider exporting and clearing old chats.");
    }
    pendingSaveRef.current = false;
  }, [addToast, windowMode, windowChatId]);

  useEffect(() => {
    if (chats.length === 0) return;
    // If any chat is actively streaming, debounce saves (every 2s)
    const isStreaming = loadingChatIds.size > 0;
    if (isStreaming) {
      if (!pendingSaveRef.current) {
        pendingSaveRef.current = true;
        saveTimerRef.current = setTimeout(() => {
          doSave();
        }, 2000);
      }
    } else {
      // Not streaming: save immediately (but clear any pending timer)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      doSave();
    }
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [chats, doSave, loadingChatIds.size]);

  // Get active chat + derived model/cwd
  const activeChat = chats.find((c) => c.id === activeChatId) || null;
  const model = activeChat?.model || "opus";
  const cwd = activeChat?.cwd || defaultCwd;

  const handleModelChange = useCallback((newModel: string) => {
    if (!activeChatId) return;
    setChats((prev) => updateChatSettings(prev, activeChatId, { model: newModel }));
  }, [activeChatId]);

  const handleCwdChange = useCallback((newCwd: string) => {
    const id = activeChatIdRef.current;
    if (!id) {
      // No active chat — update defaultCwd instead
      setDefaultCwd(newCwd);
      return;
    }
    setChats((prev) => updateChatSettings(prev, id, { cwd: newCwd }));
  }, []);

  // =========================================
  // Chat Actions
  // =========================================

  const handleNewChat = useCallback((): string => {
    const newChat = createChat("opus", defaultCwd, appSettings);
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setInputValue("");
    return newChat.id;
  }, [defaultCwd, appSettings]);

  const handleDeleteChat = useCallback(
    (chatId: string) => {
      // Soft delete with Undo — keep the deleted chat for 5 seconds
      const deletedChat = chatsRef.current.find((c) => c.id === chatId);
      if (!deletedChat) return;

      // Remove from list immediately
      setChats((prev) => deleteChatFromList(prev, chatId));
      if (activeChatId === chatId) {
        setChats((prev) => {
          const remaining = prev;
          setActiveChatId(remaining.length > 0 ? remaining[0].id : null);
          return prev;
        });
      }

      // Show undo toast
      const chatTitle = deletedChat.title.length > 20
        ? deletedChat.title.slice(0, 20) + "..."
        : deletedChat.title;

      addToastWithAction(
        "info",
        `"${chatTitle}" deleted`,
        {
          label: "Undo",
          onClick: () => {
            // Restore the deleted chat
            setChats((prev) => {
              // Insert back and sort will handle position
              return [...prev, deletedChat];
            });
            setActiveChatId(deletedChat.id);
          },
        },
        5000
      );
    },
    [activeChatId, addToastWithAction]
  );

  const handleSelectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setInputValue("");
    setChatSearchOpen(false);
    // Reset unread badge when selecting a chat
    setChats((prev) => resetUnread(prev, chatId));
  }, []);

  const handleExportChat = useCallback((chatId: string, format: "md" | "json") => {
    const chat = chatsRef.current.find((c) => c.id === chatId);
    if (!chat) return;
    const safeName = chat.title.replace(/[^a-zA-Z0-9가-힣\s-_]/g, "").trim() || "chat";
    if (format === "md") {
      downloadFile(exportChatAsMarkdown(chat), `${safeName}.md`, "text/markdown");
    } else {
      downloadFile(exportChatAsJSON(chat), `${safeName}.json`, "application/json");
    }
  }, []);

  const handleBranchChat = useCallback((messageIndex: number) => {
    if (!activeChatId) return;
    const result = branchChat(chatsRef.current, activeChatId, messageIndex);
    if (result) {
      setChats(result.chats);
      setActiveChatId(result.newChatId);
    }
  }, [activeChatId]);

  const handleChatSettingsChange = useCallback((settings: Chat["settings"]) => {
    if (!activeChatId) return;
    setChats((prev) => updateChatSettings(prev, activeChatId, { settings }));
  }, [activeChatId]);

  const handleReorderChat = useCallback((chatId: string, newIndex: number) => {
    setChats((prev) => reorderChats(prev, chatId, newIndex));
  }, []);

  const handleRenameChat = useCallback((chatId: string, newTitle: string) => {
    setChats((prev) => updateChatTitle(prev, chatId, newTitle));
  }, []);

  const handleTogglePin = useCallback((messageId: string) => {
    if (!activeChatId) return;
    setChats((prev) => togglePinMessage(prev, activeChatId, messageId));
  }, [activeChatId]);

  const handleToggleChatPin = useCallback((chatId: string) => {
    setChats((prev) => toggleChatPin(prev, chatId));
  }, []);

  // =========================================
  // Desktop Notification Helper
  // =========================================

  const sendDesktopNotification = useCallback((title: string, body: string, chatId?: string) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (!document.hidden) return; // Only notify when tab is not visible

    const notification = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: chatId || "agent-browser",
    });
    notification.onclick = () => {
      window.focus();
      if (chatId) {
        setActiveChatId(chatId);
      }
      notification.close();
    };
  }, []);

  // =========================================
  // Tray Badge: sync total unread count to Electron
  // =========================================
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { setTrayBadge?: (count: number) => void } }).electronAPI;
    if (!api?.setTrayBadge) return;
    const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    api.setTrayBadge(totalUnread);
  }, [chats]);

  // =========================================
  // Text Delta Batching — accumulate text deltas and flush once per animation frame
  // Prevents dozens of setChats() calls per second during streaming
  // =========================================
  const textDeltaBufferRef = useRef<Map<string, { chatId: string; msgId: string; text: string }>>(new Map());
  const textDeltaRafRef = useRef<number | null>(null);

  const flushTextDeltas = useCallback(() => {
    textDeltaRafRef.current = null;
    const buffer = textDeltaBufferRef.current;
    if (buffer.size === 0) return;

    // Collect all pending deltas
    const entries = Array.from(buffer.entries());
    buffer.clear();

    // Apply all accumulated text deltas in a single setChats call
    setChats((prev) => {
      let next = prev;
      for (const [, { chatId, msgId, text }] of entries) {
        next = updateMessageInChat(next, chatId, msgId, (msg) => ({
          ...msg,
          content: (msg as AssistantTextMessage).content + text,
        }));
      }
      return next;
    });
  }, []);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (textDeltaRafRef.current !== null) {
        cancelAnimationFrame(textDeltaRafRef.current);
      }
    };
  }, []);

  // =========================================
  // Stream Event Handler (per-chat, chatId captured in closure)
  // =========================================

  const createStreamHandler = useCallback((chatId: string) => {
    // Initialize per-chat stream state
    streamStateRef.current.set(chatId, {
      assistantId: null,
      toolUseId: null,
      toolInputBuffer: {},
      toolUseMessageIdMap: new Map(),
    });

    return (event: StreamEvent) => {
      const state = streamStateRef.current.get(chatId);
      if (!state) return;

      // Mark stream as connected on first event
      setStreamConnectedChatIds((prev) => {
        if (prev.has(chatId)) return prev;
        const next = new Set(prev);
        next.add(chatId);
        return next;
      });

      switch (event.type) {
        case "stream_init":
          // Backend sends stream ID for abort support
          if (event.streamId) {
            streamIdsRef.current.set(chatId, event.streamId);
          }
          break;

        case "session_init":
          setChats((prev) => setChatSessionId(prev, chatId, event.sessionId));
          break;

        case "text_delta": {
          // Clear status message when real content starts flowing
          setStatusMessages((prev) => {
            if (!prev.has(chatId)) return prev;
            const next = new Map(prev);
            next.delete(chatId);
            return next;
          });
          if (!state.assistantId) {
            // First delta: create the message immediately
            const newMsg: AssistantTextMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: event.text,
              timestamp: Date.now(),
              isStreaming: true,
            };
            state.assistantId = newMsg.id;
            setChats((prev) => addMessageToChat(prev, chatId, newMsg));
          } else {
            // Subsequent deltas: accumulate in buffer and flush via rAF
            const key = `${chatId}:${state.assistantId}`;
            const existing = textDeltaBufferRef.current.get(key);
            if (existing) {
              existing.text += event.text;
            } else {
              textDeltaBufferRef.current.set(key, {
                chatId,
                msgId: state.assistantId,
                text: event.text,
              });
            }
            // Schedule flush if not already pending
            if (textDeltaRafRef.current === null) {
              textDeltaRafRef.current = requestAnimationFrame(flushTextDeltas);
            }
          }
          break;
        }

        case "text_done": {
          // Flush any pending text deltas before marking done
          flushTextDeltas();
          if (state.assistantId) {
            const msgId = state.assistantId;
            setChats((prev) =>
              updateMessageInChat(prev, chatId, msgId, (msg) => ({
                ...msg,
                isStreaming: false,
              }))
            );
            state.assistantId = null;
          }
          break;
        }

        case "interrupted": {
          // Flush any pending text deltas before handling interrupt
          flushTextDeltas();
          // Current turn was interrupted by a mid-stream user message.
          // Mark any streaming assistant message as done.
          if (state.assistantId) {
            const msgId = state.assistantId;
            setChats((prev) =>
              updateMessageInChat(prev, chatId, msgId, (msg) => ({
                ...msg,
                isStreaming: false,
              }))
            );
            state.assistantId = null;
          }
          // Mark any running tool as stopped
          if (state.toolUseId) {
            const toolId = state.toolUseId;
            setChats((prev) =>
              updateMessageInChat(prev, chatId, toolId, (msg) => ({
                ...msg,
                isRunning: false,
              }))
            );
            state.toolUseId = null;
          }
          break;
        }

        case "tool_use_start": {
          // Flush any pending text deltas before tool use
          flushTextDeltas();
          if (state.assistantId) {
            const msgId = state.assistantId;
            setChats((prev) =>
              updateMessageInChat(prev, chatId, msgId, (msg) => ({
                ...msg,
                isStreaming: false,
              }))
            );
            state.assistantId = null;
          }

          const toolMsg: ToolUseMessage = {
            id: crypto.randomUUID(),
            role: "tool_use",
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            input: {},
            timestamp: Date.now(),
            isRunning: true,
          };
          state.toolUseId = event.toolUseId;
          state.toolInputBuffer[event.toolUseId] = "";
          state.toolUseMessageIdMap.set(event.toolUseId, toolMsg.id);
          setChats((prev) => addMessageToChat(prev, chatId, toolMsg));
          break;
        }

        case "tool_use_input_delta": {
          const tid = state.toolUseId;
          if (tid) {
            state.toolInputBuffer[tid] = (state.toolInputBuffer[tid] || "") + event.partialJson;
            try {
              const parsed = JSON.parse(state.toolInputBuffer[tid]);
              const msgId = state.toolUseMessageIdMap.get(tid);
              if (msgId) {
                setChats((prev) =>
                  updateMessageInChat(prev, chatId, msgId, (msg) => ({
                    ...msg,
                    input: parsed,
                  }))
                );
              }
            } catch {
              // JSON not yet complete
            }
          }
          break;
        }

        case "tool_use_done": {
          setChats((prev) =>
            updateMessageByToolUseId(prev, chatId, event.toolUseId, (msg) => ({
              ...msg,
              input: event.input || (msg as ToolUseMessage).input,
              isRunning: false,
            }))
          );
          state.toolUseId = null;
          break;
        }

        case "tool_result": {
          const resultMsg: ToolResultMessage = {
            id: crypto.randomUUID(),
            role: "tool_result",
            toolUseId: event.toolUseId,
            content: event.content,
            isError: event.isError,
            timestamp: Date.now(),
            ...(event.images?.length ? { images: event.images } : {}),
          };
          setChats((prev) => addMessageToChat(prev, chatId, resultMsg));
          setChats((prev) =>
            updateMessageByToolUseId(prev, chatId, event.toolUseId, (msg) => ({
              ...msg,
              isRunning: false,
            }))
          );
          break;
        }

        case "turn_done": {
          state.assistantId = null;
          break;
        }

        case "plan_approval": {
          // Clean up any stuck streaming states
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const cleaned = c.messages.map((m) => {
                if (m.role === "assistant" && (m as AssistantTextMessage).isStreaming) {
                  return { ...m, isStreaming: false };
                }
                if (m.role === "tool_use" && (m as ToolUseMessage).isRunning) {
                  return { ...m, isRunning: false };
                }
                return m;
              });
              return { ...c, messages: cleaned };
            })
          );
          // Add PlanApprovalMessage with allowedPrompts and plan content
          const planMsg: PlanApprovalMessage = {
            id: crypto.randomUUID(),
            role: "plan_approval",
            status: "pending",
            timestamp: Date.now(),
            allowedPrompts: event.allowedPrompts,
            planContent: event.planContent,
          };
          setChats((prev) => addMessageToChat(prev, chatId, planMsg));
          if (chatId !== activeChatIdRef.current || document.hidden) {
            setChats((prev) => incrementUnread(prev, chatId));
          }
          sendDesktopNotification("Plan Approval Needed", "Agent is waiting for your approval", chatId);
          // Clean up loading state (no result event follows)
          setLoadingChatIds((prev) => { const next = new Set(prev); next.delete(chatId); return next; });
          streamStateRef.current.delete(chatId);
          break;
        }

        case "ask_user": {
          // Clean up any stuck streaming states
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const cleaned = c.messages.map((m) => {
                if (m.role === "assistant" && (m as AssistantTextMessage).isStreaming) {
                  return { ...m, isStreaming: false };
                }
                if (m.role === "tool_use" && (m as ToolUseMessage).isRunning) {
                  return { ...m, isRunning: false };
                }
                return m;
              });
              return { ...c, messages: cleaned };
            })
          );
          // Add AskUserMessage
          const askMsg: AskUserMessage = {
            id: crypto.randomUUID(),
            role: "ask_user",
            status: "pending",
            questions: event.questions,
            timestamp: Date.now(),
          };
          setChats((prev) => addMessageToChat(prev, chatId, askMsg));
          if (chatId !== activeChatIdRef.current || document.hidden) {
            setChats((prev) => incrementUnread(prev, chatId));
          }
          sendDesktopNotification("Question from Agent", event.questions?.[0]?.question || "Agent needs your input", chatId);
          // Clean up loading state
          setLoadingChatIds((prev) => { const next = new Set(prev); next.delete(chatId); return next; });
          streamStateRef.current.delete(chatId);
          break;
        }

        case "result": {
          // Clean up any stuck streaming/running states
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const cleaned = c.messages.map((m) => {
                if (m.role === "assistant" && (m as AssistantTextMessage).isStreaming) {
                  return { ...m, isStreaming: false };
                }
                if (m.role === "tool_use" && (m as ToolUseMessage).isRunning) {
                  return { ...m, isRunning: false };
                }
                return m;
              });
              return { ...c, messages: cleaned };
            })
          );
          setChats((prev) => {
            const chat = prev.find((c) => c.id === chatId);
            if (chat && chat.title === "New Chat") {
              const firstUserMsg = chat.messages.find((m) => m.role === "user");
              if (firstUserMsg && "content" in firstUserMsg) {
                return updateChatTitle(prev, chatId, generateTitle(firstUserMsg.content as string));
              }
            }
            return prev;
          });
          if (event.costUsd || event.durationMs || event.inputTokens || event.outputTokens) {
            setChats((prev) => updateChatCost(prev, chatId, event.costUsd || 0, event.durationMs || 0, event.inputTokens, event.outputTokens, event.turnCount));
          }
          // Toast for background chat completion + desktop notification + unread badge
          if (chatId !== activeChatIdRef.current || document.hidden) {
            const chat = chatsRef.current.find((c) => c.id === chatId);
            const title = chat?.title || "Chat";
            addToast("success", `"${title}" completed`);
            setChats((prev) => incrementUnread(prev, chatId));
          }
          {
            const chat = chatsRef.current.find((c) => c.id === chatId);
            sendDesktopNotification("Agent Complete", chat?.title || "Task finished", chatId);
          }
          setLoadingChatIds((prev) => { const next = new Set(prev); next.delete(chatId); return next; });
          streamStateRef.current.delete(chatId);
          break;
        }

        case "error": {
          // Clean up any stuck streaming/running states
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const cleaned = c.messages.map((m) => {
                if (m.role === "assistant" && (m as AssistantTextMessage).isStreaming) {
                  return { ...m, isStreaming: false };
                }
                if (m.role === "tool_use" && (m as ToolUseMessage).isRunning) {
                  return { ...m, isRunning: false };
                }
                return m;
              });
              return { ...c, messages: cleaned };
            })
          );
          const errMsg: ErrorMessage = {
            id: crypto.randomUUID(),
            role: "error",
            content: event.message,
            timestamp: Date.now(),
          };
          setChats((prev) => addMessageToChat(prev, chatId, errMsg));
          // Toast for background chat error + desktop notification + unread badge
          if (chatId !== activeChatIdRef.current || document.hidden) {
            const chat = chatsRef.current.find((c) => c.id === chatId);
            const title = chat?.title || "Chat";
            addToast("error", `"${title}" failed`);
            setChats((prev) => incrementUnread(prev, chatId));
          }
          sendDesktopNotification("Agent Error", event.message.slice(0, 100), chatId);
          setLoadingChatIds((prev) => { const next = new Set(prev); next.delete(chatId); return next; });
          streamStateRef.current.delete(chatId);
          break;
        }

        case "status": {
          // System status messages (auto-compact, context compression, etc.)
          setStatusMessages((prev) => {
            const next = new Map(prev);
            next.set(chatId, event.message);
            return next;
          });
          break;
        }
      }
    };
  }, [sendDesktopNotification, addToast, flushTextDeltas]);

  // =========================================
  // Send Message
  // =========================================

  const doSend = useCallback(async (fullMessage: string, displayText: string, images?: string[]) => {
    let chatId = activeChatIdRef.current;
    if (!chatId) {
      const newChat = createChat("opus", defaultCwd, appSettings);
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      chatId = newChat.id;
      activeChatIdRef.current = chatId;
    }

    // If this chat is already streaming, inject the message mid-stream
    if (abortControllersRef.current.has(chatId)) {
      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: displayText,
        timestamp: Date.now(),
        ...(images && images.length > 0 ? { images } : {}),
      };
      setChats((prev) => addMessageToChat(prev, chatId!, userMsg));

      // Try mid-stream injection via /api/chat/inject
      const streamId = streamIdsRef.current.get(chatId);
      if (streamId) {
        try {
          const res = await fetch("/api/chat/inject", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ streamId, message: fullMessage, images }),
          });
          if (res.ok) {
            console.log(`[inject] Message injected mid-stream for ${chatId}`);
            return;
          }
        } catch (err) {
          console.log(`[inject] Failed, falling back to queue:`, err);
        }
      }

      // Fallback: queue for after stream completes
      const queue = pendingMessagesRef.current.get(chatId) || [];
      queue.push({ fullMessage, displayText, images });
      pendingMessagesRef.current.set(chatId, queue);
      return;
    }

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: displayText,
      timestamp: Date.now(),
      ...(images && images.length > 0 ? { images } : {}),
    };
    setChats((prev) => addMessageToChat(prev, chatId!, userMsg));
    setLoadingChatIds((prev) => new Set(prev).add(chatId!));
    loadingStartTimesRef.current.set(chatId!, Date.now());

    const chat = chatsRef.current.find((c) => c.id === chatId);
    const sessionId = chat?.sessionId || undefined;
    const chatSettings = chat?.settings;
    const chatModel = chat?.model || "opus";
    const chatCwd = chat?.cwd || defaultCwd;

    // Create per-chat stream handler (chatId captured in closure)
    const onEvent = createStreamHandler(chatId);

    try {
      const controller = new AbortController();
      abortControllersRef.current.set(chatId, controller);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: fullMessage,
          sessionId,
          model: chatModel,
          cwd: chatCwd || undefined,
          systemPrompt: chatSettings?.systemPrompt || appSettings.defaultSystemPrompt || undefined,
          maxTurns: chatSettings?.maxTurns || appSettings.defaultMaxTurns || undefined,
          maxBudgetUsd: chatSettings?.maxBudgetUsd || appSettings.defaultMaxBudgetUsd || undefined,
          mcpServers: appSettings.mcpServers.length > 0 ? appSettings.mcpServers : undefined,
          images: images && images.length > 0 ? images : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      await readNDJSONStream(response, onEvent);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setLoadingChatIds((prev) => { const next = new Set(prev); next.delete(chatId!); return next; });
        streamStateRef.current.delete(chatId!);
        return;
      }
      const errMsg: ErrorMessage = {
        id: crypto.randomUUID(),
        role: "error",
        content: err instanceof Error ? err.message : "Failed to connect to agent",
        timestamp: Date.now(),
      };
      setChats((prev) => addMessageToChat(prev, chatId!, errMsg));
      setLoadingChatIds((prev) => { const next = new Set(prev); next.delete(chatId!); return next; });
      streamStateRef.current.delete(chatId!);
    } finally {
      // Always clean up: abort controller, loading state, stream state, stream ID
      abortControllersRef.current.delete(chatId!);
      streamIdsRef.current.delete(chatId!);
      setLoadingChatIds((prev) => { const next = new Set(prev); next.delete(chatId!); return next; });
      setStreamConnectedChatIds((prev) => { const next = new Set(prev); next.delete(chatId!); return next; });
      setStatusMessages((prev) => { const next = new Map(prev); next.delete(chatId!); return next; });
      loadingStartTimesRef.current.delete(chatId!);
      streamStateRef.current.delete(chatId!);

      // Process queued messages (sent while AI was streaming)
      const queue = pendingMessagesRef.current.get(chatId!);
      if (queue && queue.length > 0) {
        const next = queue.shift()!;
        if (queue.length === 0) pendingMessagesRef.current.delete(chatId!);
        // Small delay so UI updates before next stream starts
        setTimeout(() => doSend(next.fullMessage, next.displayText, next.images), 150);
      }
    }
  }, [createStreamHandler, defaultCwd, appSettings]);

  const handleSend = useCallback(async () => {
    const message = inputValue.trim();
    if (!message && attachments.length === 0) return;

    const textAtts = attachments.filter((a) => a.type !== "image");
    const imageAtts = attachments.filter((a) => a.type === "image");

    let fullMessage = message;
    if (textAtts.length > 0) {
      const attachmentText = textAtts
        .map((a) => `<file name="${a.name}">\n${a.content}\n</file>`)
        .join("\n\n");
      fullMessage = attachmentText + (message ? "\n\n" + message : "");
    }

    // Collect display text
    const allNames = attachments.map((a) => a.name);
    const displayText = allNames.length > 0
      ? (message || "") + `\n\n\uD83D\uDCCE ${allNames.join(", ")}`
      : message;

    // Upload images to server first, get back file paths (avoids localStorage overflow)
    let imagePaths: string[] = [];
    if (imageAtts.length > 0) {
      try {
        const chatCwd = chatsRef.current.find((c) => c.id === activeChatIdRef.current)?.cwd || defaultCwd;
        const res = await fetch("/api/upload-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: imageAtts.map((a) => a.dataUrl!), cwd: chatCwd || undefined }),
        });
        const data = await res.json();
        imagePaths = data.paths || [];
      } catch {
        addToast("warning", "Image upload failed. Images will not be included.");
      }
    }

    setInputValue("");
    setAttachments([]);
    await doSend(fullMessage, displayText, imagePaths);
  }, [inputValue, attachments, doSend, defaultCwd]);

  const handleSendDirect = useCallback(async (prompt: string) => {
    await doSend(prompt, prompt);
  }, [doSend]);

  const handleStop = useCallback(() => {
    const chatId = activeChatIdRef.current;
    if (!chatId) return;

    // 1. Signal the backend to abort the SDK process
    const streamId = streamIdsRef.current.get(chatId);
    if (streamId) {
      fetch("/api/chat/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId }),
      }).catch(() => { /* ignore abort endpoint errors */ });
      streamIdsRef.current.delete(chatId);
    }

    // 2. Abort the frontend fetch stream
    const controller = abortControllersRef.current.get(chatId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(chatId);
    }

    // 3. Clean up UI state
    setLoadingChatIds((prev) => { const next = new Set(prev); next.delete(chatId); return next; });
    streamStateRef.current.delete(chatId);

    // 4. Clear pending message queue (user explicitly stopped)
    pendingMessagesRef.current.delete(chatId);
  }, []);

  // Edit user message: truncate messages after it, re-send with new content
  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    const chatId = activeChatIdRef.current;
    if (!chatId) return;

    setChats((prev) => {
      const chat = prev.find((c) => c.id === chatId);
      if (!chat) return prev;
      const idx = chat.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return prev;
      const truncated = chat.messages.slice(0, idx);
      return prev.map((c) => c.id === chatId ? { ...c, messages: truncated, sessionId: null } : c);
    });

    setTimeout(() => doSend(newContent, newContent), 50);
  }, [doSend]);

  // Regenerate: remove last assistant message(s) and re-send last user message
  const handleRegenerate = useCallback(() => {
    const chatId = activeChatIdRef.current;
    if (!chatId) return;

    const chat = chatsRef.current.find((c) => c.id === chatId);
    if (!chat) return;

    let lastUserIdx = -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;

    const lastUserContent = (chat.messages[lastUserIdx] as { content: string }).content;

    setChats((prev) =>
      prev.map((c) => c.id === chatId
        ? { ...c, messages: c.messages.slice(0, lastUserIdx), sessionId: null }
        : c
      )
    );

    setTimeout(() => doSend(lastUserContent, lastUserContent), 50);
  }, [doSend]);

  // Retry: remove error message and re-send last user message
  const handleRetry = useCallback(() => {
    const chatId = activeChatIdRef.current;
    if (!chatId) return;

    const chat = chatsRef.current.find((c) => c.id === chatId);
    if (!chat) return;

    let lastUserIdx = -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;

    const lastUserContent = (chat.messages[lastUserIdx] as { content: string }).content;

    setChats((prev) =>
      prev.map((c) => c.id === chatId
        ? { ...c, messages: c.messages.slice(0, lastUserIdx), sessionId: null }
        : c
      )
    );

    setTimeout(() => doSend(lastUserContent, lastUserContent), 50);
  }, [doSend]);

  // =========================================
  // Slash Commands
  // =========================================

  const slashCommands = useMemo(() => SLASH_COMMANDS, []);

  const handleCommand = useCallback((command: string, args: string) => {
    const chatId = activeChatIdRef.current;

    switch (command) {
      case "clear": {
        if (!chatId) return;
        setChats((prev) =>
          prev.map((c) => c.id === chatId ? { ...c, messages: [] as UIMessage[], sessionId: null, costUsd: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, turnCount: 0 } : c)
        );
        break;
      }
      case "compact": {
        if (!chatId) return;
        const chat = chatsRef.current.find((c) => c.id === chatId);
        if (!chat || !chat.sessionId) {
          // No active session — nothing to compact
          const noSessionMsg: AssistantTextMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "No active session to compact. Start a conversation first.",
            timestamp: Date.now(),
            isStreaming: false,
          };
          setChats((prev) => addMessageToChat(prev, chatId, noSessionMsg));
          return;
        }

        // SDK-style compact: send /compact as a prompt to resume the session.
        // The SDK will compress the conversation context internally and yield a compact_boundary event.
        // The session is maintained — context is compressed but the conversation continues.
        const compactPrompt = args.trim()
          ? `/compact ${args.trim()}`
          : "/compact";

        // Show status indicator
        const compactStatusMsg: AssistantTextMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Compressing conversation context...",
          timestamp: Date.now(),
          isStreaming: true,
        };
        setChats((prev) => addMessageToChat(prev, chatId, compactStatusMsg));

        // Send /compact through the normal chat flow (resuming current session)
        const compactChatId = chatId;
        const compactMsgId = compactStatusMsg.id;
        (async () => {
          try {
            const chatCwd = chat.cwd || defaultCwd;
            const response = await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                message: compactPrompt,
                sessionId: chat.sessionId,
                model: chat.model || "opus",
                cwd: chatCwd || undefined,
              }),
            });

            if (!response.ok) throw new Error("Compact failed");

            // Process the stream — look for compact_boundary status
            let gotCompacted = false;
            if (response.body) {
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              let buffer = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const event = JSON.parse(line) as StreamEvent;
                    if (event.type === "status" && typeof event.message === "string" &&
                        event.message.toLowerCase().includes("compact")) {
                      gotCompacted = true;
                    }
                  } catch { /* skip */ }
                }
              }
            }

            // Update the status message
            setChats((prev) =>
              updateMessageInChat(prev, compactChatId, compactMsgId, (msg) => ({
                ...msg,
                content: gotCompacted
                  ? "✓ Conversation context compressed. Session continues — previous context is preserved in compressed form."
                  : "✓ Compact request sent. Context has been compressed.",
                isStreaming: false,
              }))
            );
          } catch {
            setChats((prev) =>
              updateMessageInChat(prev, compactChatId, compactMsgId, (msg) => ({
                ...msg,
                content: "Compact failed. Please try again.",
                isStreaming: false,
              }))
            );
          }
        })();
        break;
      }
      case "help": {
        if (!chatId) {
          const newChat = createChat("opus", defaultCwd, appSettings);
          setChats((prev) => [newChat, ...prev]);
          setActiveChatId(newChat.id);
          activeChatIdRef.current = newChat.id;
        }
        const targetId = activeChatIdRef.current!;
        const helpText = [
          "**Available Commands:**",
          "",
          "| Command | Description |",
          "|---------|-------------|",
          "| `/clear` | Clear all messages in current chat |",
          "| `/compact [instructions]` | Compress conversation context (keeps session) |",
          "| `/download <path>` | Download a file from server |",
          "| `/export [md\\|json]` | Export chat |",
          "| `/help` | Show this help |",
          "",
          "**Keyboard Shortcuts:**",
          "",
          "| Shortcut | Action |",
          "|----------|--------|",
          "| `Ctrl+N` | New chat |",
          "| `Ctrl+F` | Search in conversation |",
          "| `Ctrl+K` | Search conversations |",
          "| `Ctrl+,` | Settings |",
          "| `Ctrl+E` | Toggle Explorer |",
          "| `Ctrl+Shift+E` | Export as Markdown |",
        ].join("\n");
        const msg: AssistantTextMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: helpText,
          timestamp: Date.now(),
          isStreaming: false,
        };
        setChats((prev) => addMessageToChat(prev, targetId, msg));
        break;
      }
      case "export": {
        if (!chatId) return;
        const format = args.trim().toLowerCase() === "json" ? "json" : "md";
        handleExportChat(chatId, format as "md" | "json");
        break;
      }
      case "download": {
        const filePath = args.trim();
        if (!filePath) {
          if (!chatId) return;
          const msg: AssistantTextMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Usage: `/download <file path>`\n\nExample: `/download C:\\project\\build\\app.apk`",
            timestamp: Date.now(),
            isStreaming: false,
          };
          setChats((prev) => addMessageToChat(prev, chatId, msg));
          return;
        }
        // Trigger browser download
        const downloadUrl = `/api/download?path=${encodeURIComponent(filePath)}`;
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Show confirmation
        if (chatId) {
          const fileName = filePath.split(/[\\/]/).pop() || filePath;
          const msg: AssistantTextMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Downloading **${fileName}**...`,
            timestamp: Date.now(),
            isStreaming: false,
          };
          setChats((prev) => addMessageToChat(prev, chatId, msg));
        }
        break;
      }
    }
  }, [doSend, defaultCwd, handleExportChat]);

  // =========================================
  // Plan Approval Handler
  // =========================================

  const handlePlanApproval = useCallback(async (approved: boolean, feedback?: string) => {
    const chatId = activeChatIdRef.current;
    if (!chatId) return;

    // Update PlanApprovalMessage status
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.role === "plan_approval" && (m as PlanApprovalMessage).status === "pending"
              ? { ...m, status: approved ? "approved" : "rejected", feedback } as PlanApprovalMessage
              : m
          ),
        };
      })
    );

    // Only resume session on approval — rejection just stops the agent
    if (approved) {
      const msg = feedback
        ? `The user approved the plan with these additional comments: ${feedback}. Proceed with implementation, incorporating the user's feedback.`
        : "The user approved the plan. Proceed with implementation.";
      const display = feedback ? `Plan approved: ${feedback}` : "Plan approved";
      await doSend(msg, display);
    }
    // Reject: do nothing — agent stays paused, user can send new instructions
  }, [doSend]);

  // =========================================
  // AskUserQuestion Answer Handler
  // =========================================

  const handleAskUserAnswer = useCallback(async (answers: Record<string, string>) => {
    const chatId = activeChatIdRef.current;
    if (!chatId) return;

    // Update AskUserMessage status
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.role === "ask_user" && (m as AskUserMessage).status === "pending"
              ? { ...m, status: "answered", answers } as AskUserMessage
              : m
          ),
        };
      })
    );

    // Format answers as human-readable text for session resume
    const answerLines = Object.entries(answers)
      .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
      .join("\n\n");

    const displayText = Object.values(answers).join(", ").slice(0, 80);

    await doSend(
      `The user answered the questions:\n\n${answerLines}`,
      `Answered: ${displayText}`
    );
  }, [doSend]);

  // =========================================
  // Window Mode
  // =========================================

  // For chat window mode: override activeChatId to the URL chatId
  useEffect(() => {
    if (windowMode === "chat" && windowChatId) {
      setActiveChatId(windowChatId);
      activeChatIdRef.current = windowChatId;
    }
  }, [windowMode, windowChatId]);

  // Chat window: set window title to chat title
  useEffect(() => {
    if (windowMode === "chat" && activeChat?.title) {
      window.electronAPI?.setWindowTitle(activeChat.title);
    }
  }, [windowMode, activeChat?.title]);

  // Cross-window sync via storage events
  const lastStorageSnapshotRef = useRef<string>("");
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      // Sync theme/appSettings across all windows
      if (e.key === "claude-agent-app-settings") {
        const updated = loadAppSettings();
        setAppSettings(updated);
        document.documentElement.setAttribute("data-theme", updated.theme);
      }
      // Sync chat list for main window
      if (e.key === "claude-agent-chats" && windowMode === "main") {
        const raw = e.newValue || "";
        if (raw !== lastStorageSnapshotRef.current) {
          lastStorageSnapshotRef.current = raw;
          setChats(loadChats());
        }
      }
    };
    window.addEventListener("storage", handler);
    // Main window: also poll periodically as fallback (storage event doesn't fire in same window)
    let interval: ReturnType<typeof setInterval> | undefined;
    if (windowMode === "main") {
      interval = setInterval(() => {
        const raw = localStorage.getItem("claude-agent-chats") || "";
        if (raw !== lastStorageSnapshotRef.current) {
          lastStorageSnapshotRef.current = raw;
          setChats(loadChats());
        }
      }, 3000);
    }
    return () => {
      window.removeEventListener("storage", handler);
      if (interval) clearInterval(interval);
    };
  }, [windowMode]);

  // =========================================
  // Render
  // =========================================

  const isCurrentChatLoading = loadingChatIds.has(activeChatId || "");
  const isCurrentStreamConnected = streamConnectedChatIds.has(activeChatId || "");
  const currentLoadingStartTime = loadingStartTimesRef.current.get(activeChatId || "") || 0;
  const currentStatusMessage = statusMessages.get(activeChatId || "") || "";

  // Stable callbacks for child components (prevent re-renders on inputValue change)
  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
  const handleCloseSidebar = useCallback(() => setSidebarOpen(false), []);
  const handleOpenSidebar = useCallback(() => setSidebarOpen(true), []);
  const handleToggleCollapse = useCallback(() => setSidebarCollapsed((p) => !p), []);
  const handleAttach = useCallback((files: Attachment[]) => setAttachments((prev) => [...prev, ...files]), []);
  const handleRemoveAttachment = useCallback((i: number) => setAttachments((prev) => prev.filter((_, j) => j !== i)), []);

  // Stable memoized values
  const activeMessages = useMemo(() => activeChat?.messages || [], [activeChat?.messages]);
  const activeChatSettings = useMemo(
    () => activeChat?.settings || { systemPrompt: "", maxTurns: 0, maxBudgetUsd: 0 },
    [activeChat?.settings]
  );

  // ── Electron Main Window: Chat List Only ──
  if (windowMode === "main") {
    return <MainListView
      chats={chats}
      loadingChatIds={loadingChatIds}
      onNewChat={handleNewChat}
      onDeleteChat={handleDeleteChat}
      onExportChat={handleExportChat}
      onRenameChat={handleRenameChat}
      onToggleChatPin={handleToggleChatPin}
      onOpenSettings={handleOpenSettings}
      settingsOpen={settingsOpen}
      onCloseSettings={handleCloseSettings}
      activeChatSettings={activeChatSettings}
      onChatSettingsChange={handleChatSettingsChange}
      appSettings={appSettings}
      onAppSettingsChange={handleAppSettingsChange}
      cwd={cwd}
      onCwdChange={handleCwdChange}
      terminalOpen={terminalOpen}
      onTerminalToggle={() => setTerminalOpen((p) => !p)}
    />;
  }

  // ── Electron Chat Window: Single Chat ──
  if (windowMode === "chat" && windowChatId) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopBar
          model={model}
          onModelChange={handleModelChange}
          cwd={cwd}
          onCwdChange={handleCwdChange}
          title={activeChat?.title}
        />
        <div className="flex-1 flex flex-col min-h-0">
          <ChatArea
            messages={activeMessages}
            isLoading={isCurrentChatLoading}
            isStreamConnected={isCurrentStreamConnected}
            loadingStartTime={currentLoadingStartTime}
            statusMessage={currentStatusMessage}
            onSendPrompt={handleSendDirect}
            onBranchChat={handleBranchChat}
            onPlanApproval={handlePlanApproval}
            onAskUserAnswer={handleAskUserAnswer}
            onTogglePin={handleTogglePin}
            onEditMessage={handleEditMessage}
            onRegenerate={handleRegenerate}
            onRetry={handleRetry}
            chatCost={activeChat?.costUsd}
            chatDuration={activeChat?.durationMs}
            chatInputTokens={activeChat?.inputTokens}
            chatOutputTokens={activeChat?.outputTokens}
            chatTurnCount={activeChat?.turnCount}
            searchOpen={chatSearchOpen}
            onSearchClose={() => setChatSearchOpen(false)}
          />
          <MessageInput
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            onStop={handleStop}
            onCommand={handleCommand}
            isLoading={isCurrentChatLoading}
            attachments={attachments}
            onAttach={handleAttach}
            onRemoveAttachment={handleRemoveAttachment}
            slashCommands={slashCommands}
          />
        </div>
        <SettingsModal
          isOpen={settingsOpen}
          onClose={handleCloseSettings}
          chatSettings={activeChatSettings}
          onChatSettingsChange={handleChatSettingsChange}
          appSettings={appSettings}
          onAppSettingsChange={handleAppSettingsChange}
        />
      </div>
    );
  }

  // ── Browser Mode: Full Layout (unchanged) ──
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        onExportChat={handleExportChat}
        onOpenSettings={handleOpenSettings}
        onReorderChat={handleReorderChat}
        onRenameChat={handleRenameChat}
        onToggleChatPin={handleToggleChatPin}
        isOpen={sidebarOpen}
        onClose={handleCloseSidebar}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
        loadingChatIds={loadingChatIds}
        loadingStartTimes={loadingStartTimesRef.current}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        <TopBar
          model={model}
          onModelChange={handleModelChange}
          cwd={cwd}
          onCwdChange={handleCwdChange}
          terminalOpen={terminalOpen}
          onTerminalToggle={() => setTerminalOpen((p) => !p)}
          onMenuClick={handleOpenSidebar}
        />

        <div className="flex-1 flex min-h-0">
          <div
            ref={chatColumnRef}
            className="flex flex-col min-w-0 w-full"
          >
            <div className="flex flex-col min-h-0" style={{ height: terminalOpen ? `${100 - terminalHeight}%` : "100%" }}>
              <ChatArea
                messages={activeMessages}
                isLoading={isCurrentChatLoading}
                isStreamConnected={isCurrentStreamConnected}
                loadingStartTime={currentLoadingStartTime}
                statusMessage={currentStatusMessage}
                onSendPrompt={handleSendDirect}
                onBranchChat={handleBranchChat}
                onPlanApproval={handlePlanApproval}
                onAskUserAnswer={handleAskUserAnswer}
                onTogglePin={handleTogglePin}
                onEditMessage={handleEditMessage}
                onRegenerate={handleRegenerate}
                onRetry={handleRetry}
                chatCost={activeChat?.costUsd}
                chatDuration={activeChat?.durationMs}
                chatInputTokens={activeChat?.inputTokens}
                chatOutputTokens={activeChat?.outputTokens}
                chatTurnCount={activeChat?.turnCount}
                searchOpen={chatSearchOpen}
                onSearchClose={() => setChatSearchOpen(false)}
              />
              <MessageInput
                value={inputValue}
                onChange={setInputValue}
                onSend={handleSend}
                onStop={handleStop}
                onCommand={handleCommand}
                isLoading={isCurrentChatLoading}
                attachments={attachments}
                onAttach={handleAttach}
                onRemoveAttachment={handleRemoveAttachment}
                slashCommands={slashCommands}
              />
            </div>

            {terminalOpen && (
              <div
                onMouseDown={handleTermMouseDown}
                className="h-1 hover:h-1 bg-border hover:bg-accent/50 cursor-row-resize transition-colors flex-shrink-0"
              />
            )}
            {terminalOpen && (
              <div className="flex-shrink-0 border-t border-border" style={{ height: `${terminalHeight}%` }}>
                <TerminalPanel cwd={cwd} chatId={activeChatId || "default"} />
              </div>
            )}
          </div>
        </div>
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={handleCloseSettings}
        chatSettings={activeChatSettings}
        onChatSettingsChange={handleChatSettingsChange}
        appSettings={appSettings}
        onAppSettingsChange={handleAppSettingsChange}
      />
    </div>
  );
}

// =========================================
// Main List View (Electron Main Window)
// =========================================

function MainListView({
  chats,
  loadingChatIds,
  onNewChat,
  onDeleteChat,
  onExportChat,
  onRenameChat,
  onToggleChatPin,
  onOpenSettings,
  settingsOpen,
  onCloseSettings,
  activeChatSettings,
  onChatSettingsChange,
  appSettings,
  onAppSettingsChange,
  cwd,
  onCwdChange,
  terminalOpen,
  onTerminalToggle,
}: {
  chats: Chat[];
  loadingChatIds: Set<string>;
  onNewChat: () => string;
  onDeleteChat: (chatId: string) => void;
  onExportChat: (chatId: string, format: "md" | "json") => void;
  onRenameChat: (chatId: string, newTitle: string) => void;
  onToggleChatPin?: (chatId: string) => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  activeChatSettings: Chat["settings"];
  onChatSettingsChange: (settings: Chat["settings"]) => void;
  appSettings: AppSettings;
  onAppSettingsChange: (settings: AppSettings) => void;
  cwd: string;
  onCwdChange: (cwd: string) => void;
  terminalOpen: boolean;
  onTerminalToggle: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [terminalHeight] = useState(40);

  const isElectron = typeof window !== "undefined" && !!window.electronAPI;

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI!.isMaximized().then(setIsMaximized);
    const cleanup = window.electronAPI!.onMaximizeChange(setIsMaximized);
    return cleanup;
  }, [isElectron]);

  // Sort and filter chats
  const sortedChats = useMemo(() => {
    const sorted = [...chats].sort((a, b) => {
      // Pinned chats always come first
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return b.createdAt - a.createdAt;
    });
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => "content" in m && typeof m.content === "string" && m.content.toLowerCase().includes(q))
    );
  }, [chats, searchQuery]);

  // Clamp selectedIndex
  useEffect(() => {
    if (selectedIndex >= sortedChats.length) {
      setSelectedIndex(Math.max(0, sortedChats.length - 1));
    }
  }, [sortedChats.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const item = container.children[selectedIndex] as HTMLElement;
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when editing or searching
      const active = document.activeElement;
      const isInputFocused = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA";

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (isInputFocused && active === searchRef.current) {
          // Move focus from search to list
          searchRef.current?.blur();
        }
        setSelectedIndex((i) => Math.min(i + 1, sortedChats.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && !isInputFocused) {
        e.preventDefault();
        const chat = sortedChats[selectedIndex];
        if (chat) window.electronAPI?.openChatWindow(chat.id);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        const id = onNewChat();
        window.electronAPI?.openChatWindow(id);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        onOpenSettings();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        onTerminalToggle();
      } else if (e.key === "Escape") {
        if (searchQuery) {
          setSearchQuery("");
          searchRef.current?.blur();
        }
      } else if (e.key === "Delete" && !isInputFocused) {
        const chat = sortedChats[selectedIndex];
        if (chat) onDeleteChat(chat.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sortedChats, selectedIndex, searchQuery, onNewChat, onDeleteChat, onOpenSettings, onTerminalToggle]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Title bar (draggable) */}
      <div
        className="flex items-center px-3 py-1.5 border-b border-border bg-bg-secondary/50 min-h-[40px]"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="text-sm font-semibold text-text-primary">Chats</span>
        <div className="flex-1" />

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="flex items-center justify-center w-7 h-7 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title="Settings (Ctrl+,)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2.5" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" />
          </svg>
        </button>

        <div className="w-px h-4 bg-border mx-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} />

        {/* Window controls */}
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="electron-win-btn flex items-center justify-center w-[34px] h-[26px] rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button
          onClick={() => window.electronAPI?.maximize()}
          className="electron-win-btn flex items-center justify-center w-[34px] h-[26px] rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="3" y="1" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="1" y="3" width="7" height="7" rx="0.5" fill="var(--color-bg-secondary)" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
        </button>
        <button
          onClick={() => window.electronAPI?.close()}
          className="electron-win-btn electron-close-btn flex items-center justify-center w-[34px] h-[26px] rounded hover:bg-red-600 text-text-muted hover:text-white transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>

      {/* Search + New chat */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <div className="flex-1 relative">
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search (Ctrl+K)"
            className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={() => { const id = onNewChat(); window.electronAPI?.openChatWindow(id); }}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent hover:bg-accent/80 text-white transition-colors flex-shrink-0"
          title="New chat (Ctrl+N)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 1v12M1 7h12" />
          </svg>
        </button>
      </div>

      {/* Chat list */}
      <div ref={listRef} className="flex-1 overflow-y-auto" style={{ height: terminalOpen ? `${100 - terminalHeight}%` : undefined }}>
        {sortedChats.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-text-muted text-xs">
            <p>{searchQuery ? "No matching chats" : "No chats yet"}</p>
            <p className="mt-1 text-text-muted/60">Press Ctrl+N to start</p>
          </div>
        )}
        {sortedChats.map((chat, index) => {
          const isSelected = index === selectedIndex;
          const isLoading = loadingChatIds.has(chat.id);
          const lastMsg = [...chat.messages].reverse().find((m) => m.role === "user" || m.role === "assistant");
          const preview = lastMsg && "content" in lastMsg ? String(lastMsg.content).slice(0, 60) : "";
          const isEditing = editingId === chat.id;

          return (
            <div
              key={chat.id}
              className={`px-3 py-2.5 cursor-pointer border-b border-border/50 transition-colors ${
                isSelected ? "bg-accent/10 border-l-2 border-l-accent" : "hover:bg-bg-hover border-l-2 border-l-transparent"
              }`}
              onClick={() => setSelectedIndex(index)}
              onDoubleClick={() => {
                if (!isEditing) window.electronAPI?.openChatWindow(chat.id);
              }}
            >
              <div className="flex items-center gap-2">
                {/* Pin icon */}
                {chat.pinned && (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-accent flex-shrink-0 opacity-70">
                    <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707l-.707-.707-3.535 3.536.707.707a.5.5 0 0 1-.707.707l-1.414-1.414-3.536 3.536a.5.5 0 0 1-.707 0l-.707-.707-2.829 2.828a.5.5 0 1 1-.707-.707l2.829-2.828-.707-.707a.5.5 0 0 1 0-.707l3.536-3.536-1.414-1.414a.5.5 0 0 1 .707-.707l.707.707 3.536-3.535-.707-.707a.5.5 0 0 1 .146-.854z" />
                  </svg>
                )}
                {/* Loading indicator */}
                {isLoading && (
                  <div className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0" />
                )}
                {/* Title */}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRenameChat(chat.id, editValue);
                        setEditingId(null);
                      } else if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => { onRenameChat(chat.id, editValue); setEditingId(null); }}
                    className="flex-1 bg-bg-tertiary border border-accent rounded px-1 py-0.5 text-xs text-text-primary focus:outline-none"
                  />
                ) : (
                  <span className="flex-1 text-xs font-medium text-text-primary truncate">{chat.title}</span>
                )}
                {/* Unread badge */}
                {(chat.unreadCount || 0) > 0 && (
                  <span className="flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
                    {(chat.unreadCount || 0) > 99 ? "99+" : chat.unreadCount}
                  </span>
                )}
                <span className="text-[10px] text-text-muted flex-shrink-0">{formatTime(chat.updatedAt)}</span>
              </div>
              {preview && (
                <p className="text-[11px] text-text-muted truncate mt-0.5 pl-0">{preview}</p>
              )}
              {/* Hover actions */}
              {isSelected && !isEditing && (
                <div className="flex items-center gap-1 mt-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); window.electronAPI?.openChatWindow(chat.id); }}
                    className="text-[10px] text-accent hover:text-accent/80 px-1.5 py-0.5 rounded bg-accent/10"
                  >
                    Open
                  </button>
                  {onToggleChatPin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleChatPin(chat.id); }}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        chat.pinned ? "text-accent hover:text-text-muted" : "text-text-muted hover:text-accent"
                      } hover:bg-bg-hover`}
                    >
                      {chat.pinned ? "Unpin" : "Pin"}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingId(chat.id); setEditValue(chat.title); }}
                    className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-bg-hover"
                  >
                    Rename
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onExportChat(chat.id, "md"); }}
                    className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-bg-hover"
                  >
                    Export
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id); }}
                    className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Terminal panel (for login/logout) */}
      {terminalOpen && (
        <>
          <div className="h-1 bg-border hover:bg-accent/50 cursor-row-resize flex-shrink-0" />
          <div className="flex-shrink-0 border-t border-border" style={{ height: `${terminalHeight}%` }}>
            <TerminalPanel cwd={cwd} chatId="main" />
          </div>
        </>
      )}

      {/* Bottom bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-bg-secondary/30">
        <button
          onClick={onTerminalToggle}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
            terminalOpen
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
          }`}
          title="Terminal (Ctrl+`)"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 5l4 3-4 3" /><path d="M9 12h4" />
          </svg>
          Terminal
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-text-muted">{chats.length} chats</span>
      </div>

      {/* Settings */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={onCloseSettings}
        chatSettings={activeChatSettings}
        onChatSettingsChange={onChatSettingsChange}
        appSettings={appSettings}
        onAppSettingsChange={onAppSettingsChange}
      />
    </div>
  );
}
