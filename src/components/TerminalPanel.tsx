"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";

interface TerminalTab {
  id: string;
  title: string;
  chatId: string;
}

interface TerminalPanelProps {
  cwd: string;
  chatId: string;
}

export default function TerminalPanel({ cwd, chatId }: TerminalPanelProps) {
  // All tabs across all chats (persisted across chat switches)
  const [allTabs, setAllTabs] = useState<TerminalTab[]>([]);
  // Active tab per chat
  const [activeTabMap, setActiveTabMap] = useState<Record<string, string>>({});
  const initializedChatsRef = useRef<Set<string>>(new Set());

  const tabs = allTabs.filter((t) => t.chatId === chatId);
  const activeTabId = activeTabMap[chatId] || null;

  // Create first terminal when a new chat is opened
  useEffect(() => {
    if (!chatId || initializedChatsRef.current.has(chatId)) return;
    initializedChatsRef.current.add(chatId);
    createNewTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const createNewTab = useCallback(() => {
    const chatTabs = allTabs.filter((t) => t.chatId === chatId);
    const id = `term-${chatId}-${Date.now()}`;
    const newTab: TerminalTab = { id, title: `Terminal ${chatTabs.length + 1}`, chatId };
    setAllTabs((prev) => [...prev, newTab]);
    setActiveTabMap((prev) => ({ ...prev, [chatId]: id }));
  }, [chatId, allTabs]);

  const closeTab = useCallback((id: string) => {
    fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "kill", id }),
    }).catch(() => {});

    setAllTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      const chatTabs = remaining.filter((t) => t.chatId === chatId);
      if (activeTabMap[chatId] === id) {
        setActiveTabMap((m) => ({
          ...m,
          [chatId]: chatTabs.length > 0 ? chatTabs[chatTabs.length - 1].id : "",
        }));
      }
      return remaining;
    });
  }, [chatId, activeTabMap]);

  const setActiveTab = useCallback((id: string) => {
    setActiveTabMap((prev) => ({ ...prev, [chatId]: id }));
  }, [chatId]);

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-bg-secondary px-1 gap-0.5 flex-shrink-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] cursor-pointer border-b-2 transition-colors ${
              activeTabId === tab.id
                ? "border-accent text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
              <path d="M3 5l4 3-4 3" />
              <path d="M9 12h4" />
            </svg>
            <span>{tab.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="ml-1 text-text-muted hover:text-text-primary transition-colors"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 1l6 6M7 1l-6 6" />
              </svg>
            </button>
          </div>
        ))}
        <button
          onClick={createNewTab}
          className="px-2 py-1.5 text-text-muted hover:text-text-primary transition-colors"
          title="New Terminal"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>

      {/* Terminal instances — ALL tabs rendered, show/hide via display */}
      <div className="flex-1 relative min-h-0">
        {allTabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: (tab.chatId === chatId && activeTabId === tab.id) ? "block" : "none" }}
          >
            <XTermInstance
              id={tab.id}
              cwd={cwd}
              isActive={tab.chatId === chatId && activeTabId === tab.id}
            />
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="flex items-center justify-center h-full text-text-muted text-xs">
            <button onClick={createNewTab} className="hover:text-text-primary transition-colors">
              Click to create a terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Individual xterm.js instance
function XTermInstance({ id, cwd, isActive }: { id: string; cwd: string; isActive: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null);
  const [initialized, setInitialized] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const exitedRef = useRef(false);
  const cancelledRef = useRef(false);

  // Connect SSE with auto-reconnect
  const connectSSE = useCallback(() => {
    if (cancelledRef.current || exitedRef.current) return;

    const es = new EventSource(`/api/terminal?id=${encodeURIComponent(id)}`);
    eventSourceRef.current = es;
    let retryCount = 0;

    es.addEventListener("output", (e) => {
      retryCount = 0; // reset on successful data
      try {
        const data = JSON.parse(e.data);
        termRef.current?.write(data);
      } catch { /* ignore */ }
    });

    es.addEventListener("exit", () => {
      exitedRef.current = true;
      termRef.current?.writeln("\r\n[Process exited]");
      es.close();
    });

    es.onerror = () => {
      es.close();
      if (cancelledRef.current || exitedRef.current) return;
      retryCount++;
      const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 8000);
      setTimeout(() => {
        if (!cancelledRef.current && !exitedRef.current) {
          connectSSE();
        }
      }, delay);
    };
  }, [id]);

  // Initialize xterm.js and connect to backend
  useEffect(() => {
    if (!containerRef.current || initialized) return;

    cancelledRef.current = false;
    exitedRef.current = false;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (cancelledRef.current || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
        theme: {
          background: "#1a1b26",
          foreground: "#c0caf5",
          cursor: "#c0caf5",
          selectionBackground: "#33467c",
          black: "#15161e",
          red: "#f7768e",
          green: "#9ece6a",
          yellow: "#e0af68",
          blue: "#7aa2f7",
          magenta: "#bb9af7",
          cyan: "#7dcfff",
          white: "#a9b1d6",
          brightBlack: "#414868",
          brightRed: "#f7768e",
          brightGreen: "#9ece6a",
          brightYellow: "#e0af68",
          brightBlue: "#7aa2f7",
          brightMagenta: "#bb9af7",
          brightCyan: "#7dcfff",
          brightWhite: "#c0caf5",
        },
        scrollback: 5000,
        allowProposedApi: true,
      });

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(containerRef.current);

      try { fitAddon.fit(); } catch { /* ignore */ }

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Create terminal on server FIRST
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          id,
          cwd,
          cols: term.cols,
          rows: term.rows,
        }),
      });

      if (!res.ok) {
        let errMsg = "Unknown error";
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch { /* ignore */ }
        term.writeln(`\r\n\x1b[31mFailed to create terminal: ${errMsg}\x1b[0m`);
        return;
      }

      // THEN connect SSE (server-side terminal exists now)
      connectSSE();

      term.onData((data) => {
        if (exitedRef.current) return;
        fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write", id, data }),
        }).catch(() => {});
      });

      term.onResize(({ cols, rows }) => {
        if (exitedRef.current) return;
        fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resize", id, cols, rows }),
        }).catch(() => {});
      });

      setInitialized(true);
    })();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit on resize
  useEffect(() => {
    if (!fitAddonRef.current || !containerRef.current) return;

    const observer = new ResizeObserver(() => {
      try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [initialized]);

  // Fit when becoming active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      setTimeout(() => {
        try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
        termRef.current?.focus();
      }, 50);
    }
  }, [isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      eventSourceRef.current?.close();
      termRef.current?.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ padding: "4px" }}
    />
  );
}
