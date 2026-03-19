"use client";

import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import type { OpenTab } from "@/types/chat";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
}

// In-memory cache for directory listings
const fileCache = new Map<string, FileItem[]>();
// Git status cache
const gitStatusCache = new Map<string, Record<string, string>>();

interface ExplorerPanelProps {
  cwd: string;
  onFileSelect?: (filePath: string) => void;
}

// =========================================
// File Icon
// =========================================

function FileIcon({ isDirectory, name }: { isDirectory: boolean; name: string }) {
  if (isDirectory) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="#e8a838" className="flex-shrink-0">
        <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
      </svg>
    );
  }
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const colors: Record<string, string> = {
    ts: "#3178c6", tsx: "#3178c6", js: "#f7df1e", jsx: "#f7df1e",
    json: "#5bb882", css: "#563d7c", html: "#e34c26", md: "#fff",
    py: "#3776ab", rs: "#dea584", go: "#00add8", cs: "#68217a",
    java: "#b07219", cpp: "#f34b7d", c: "#555555", rb: "#701516",
    php: "#4f5d95", swift: "#f05138", kt: "#a97bff", dart: "#00b4ab",
    sql: "#e38c00", xml: "#0060ac", yaml: "#cb171e", yml: "#cb171e",
    sh: "#89e051", bat: "#c1f12e", ps1: "#012456",
  };
  const color = colors[ext] || "#8b8b8b";
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={color} className="flex-shrink-0" opacity="0.8">
      <path d="M3 1h7l3 3v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" />
    </svg>
  );
}

// =========================================
// Git status color helper
// =========================================

function gitStatusColor(status?: string): string {
  if (!status) return "";
  if (status === "M" || status === "MM") return "text-yellow-400";
  if (status === "A" || status === "??") return "text-green-400";
  if (status === "D") return "text-red-400";
  if (status === "R") return "text-blue-400";
  return "text-yellow-400";
}

function gitStatusLabel(status?: string): string {
  if (!status) return "";
  if (status === "M" || status === "MM") return "M";
  if (status === "A") return "A";
  if (status === "??") return "U";
  if (status === "D") return "D";
  if (status === "R") return "R";
  return status.charAt(0);
}

// =========================================
// FolderTree (recursive file tree)
// =========================================

function FolderTree({
  dir,
  depth,
  onFileSelect,
  selectedFile,
  refreshCounter,
  gitStatus,
  cwd,
  onContextMenu,
}: {
  dir: string;
  depth: number;
  onFileSelect?: (path: string) => void;
  selectedFile?: string | null;
  refreshCounter?: number;
  gitStatus?: Record<string, string>;
  cwd: string;
  onContextMenu?: (e: React.MouseEvent, item: FileItem) => void;
}) {
  const [items, setItems] = useState<FileItem[]>(() => fileCache.get(dir) || []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(!fileCache.has(dir));
  const [error, setError] = useState<string | null>(null);
  const hasLoaded = useRef(fileCache.has(dir));

  const load = useCallback(async () => {
    if (!hasLoaded.current && !fileCache.has(dir)) setLoading(true);
    try {
      const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (data.error && (!data.items || data.items.length === 0)) {
        setError(data.error);
        setItems([]);
      } else {
        setError(null);
        const newItems = data.items || [];
        fileCache.set(dir, newItems);
        setItems(newItems);
        // Prefetch first few visible subdirectories (limit to avoid excessive requests)
        if (depth === 0) {
          const dirs = newItems.filter((i: FileItem) => i.isDirectory).slice(0, 5);
          let delay = 0;
          dirs.forEach((d: FileItem) => {
            if (!fileCache.has(d.path)) {
              // Stagger prefetch to avoid burst of requests
              setTimeout(() => {
                if (!fileCache.has(d.path)) {
                  fetch(`/api/files?dir=${encodeURIComponent(d.path)}`)
                    .then(r => r.json())
                    .then(sub => { if (sub.items) fileCache.set(d.path, sub.items); })
                    .catch(() => {});
                }
              }, delay += 200);
            }
          });
        }
      }
    } catch (err) {
      if (!hasLoaded.current) {
        setError(err instanceof Error ? err.message : "Failed to load");
        setItems([]);
      }
    }
    setLoading(false);
    hasLoaded.current = true;
  }, [dir, depth]);

  useEffect(() => {
    load();
  }, [load, refreshCounter]);

  // Get file's git status relative to cwd
  const getFileGitStatus = useCallback((filePath: string) => {
    if (!gitStatus) return undefined;
    // Convert to relative path from cwd
    const relative = filePath
      .replace(cwd, "")
      .replace(/^[\\/]+/, "")
      .replace(/\\/g, "/");
    return gitStatus[relative];
  }, [gitStatus, cwd]);

  if (loading && depth === 0) {
    return <div className="text-xs text-text-muted px-3 py-2">Loading...</div>;
  }

  if (error && depth === 0) {
    return (
      <div className="px-3 py-2 text-xs text-red-400">
        {error}
        <button onClick={load} className="ml-2 text-accent hover:text-accent-hover underline">Retry</button>
      </div>
    );
  }

  return (
    <div>
      {items.map((item) => {
        const fileGitStatus = getFileGitStatus(item.path);
        return (
          <div key={item.path}>
            <button
              onClick={() => {
                if (item.isDirectory) {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    next.has(item.path) ? next.delete(item.path) : next.add(item.path);
                    return next;
                  });
                } else {
                  onFileSelect?.(item.path);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu?.(e, item);
              }}
              className={`flex items-center gap-1.5 w-full text-left px-2 py-[3px] text-xs hover:bg-bg-hover transition-colors group ${
                !item.isDirectory && selectedFile === item.path ? "bg-bg-tertiary" : ""
              }`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              {item.isDirectory && (
                <svg
                  width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
                  className={`flex-shrink-0 text-text-muted transition-transform ${expanded.has(item.path) ? "rotate-90" : ""}`}
                >
                  <path d="M2 1l4 3-4 3z" />
                </svg>
              )}
              {!item.isDirectory && <span className="w-2" />}
              <FileIcon isDirectory={item.isDirectory} name={item.name} />
              <span className={`truncate group-hover:text-text-primary ${
                fileGitStatus ? gitStatusColor(fileGitStatus) :
                (!item.isDirectory && selectedFile === item.path ? "text-text-primary" : "text-text-secondary")
              }`}>{item.name}</span>
              {fileGitStatus && (
                <span className={`ml-auto text-[9px] font-mono flex-shrink-0 ${gitStatusColor(fileGitStatus)}`}>
                  {gitStatusLabel(fileGitStatus)}
                </span>
              )}
            </button>
            {item.isDirectory && expanded.has(item.path) && (
              <FolderTree
                dir={item.path}
                depth={depth + 1}
                onFileSelect={onFileSelect}
                selectedFile={selectedFile}
                refreshCounter={refreshCounter}
                gitStatus={gitStatus}
                cwd={cwd}
                onContextMenu={onContextMenu}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// =========================================
// CodeMirror Preview (lazy loaded)
// =========================================

function CodeMirrorPreview({ content, fileName }: { content: string; fileName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editorComponent, setEditorComponent] = useState<React.ReactNode>(null);
  const [isDark, setIsDark] = useState(true);

  // Detect theme
  useEffect(() => {
    const detect = () => {
      const t = document.documentElement.getAttribute("data-theme");
      setIsDark(t !== "light");
    };
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // Load CodeMirror
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [
          { default: CodeMirror },
          { EditorView },
          { getLanguageExtension },
        ] = await Promise.all([
          import("@uiw/react-codemirror"),
          import("@codemirror/view"),
          import("@/lib/codemirror-langs"),
        ]);

        const extensions = [
          EditorView.editable.of(false),
          EditorView.lineWrapping,
        ];

        // Load theme
        let theme: import("@codemirror/state").Extension | undefined;
        if (isDark) {
          const { oneDark } = await import("@codemirror/theme-one-dark");
          theme = oneDark;
        }

        // Load language
        const langExt = await getLanguageExtension(fileName);
        if (langExt) extensions.push(langExt);

        if (!cancelled) {
          setEditorComponent(
            <CodeMirror
              value={content}
              readOnly={true}
              editable={false}
              theme={theme || "light"}
              extensions={extensions}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                bracketMatching: true,
                highlightActiveLine: false,
                highlightSelectionMatches: true,
                searchKeymap: true,
              }}
              className="h-full [&_.cm-editor]:!h-full [&_.cm-scroller]:!overflow-auto [&_.cm-gutters]:!border-r-0"
              style={{ height: "100%", fontSize: "12px" }}
            />
          );
        }
      } catch {
        if (!cancelled) setEditorComponent(null);
      }
    })();
    return () => { cancelled = true; };
  }, [content, fileName, isDark]);

  if (editorComponent) {
    return (
      <div ref={containerRef} className="flex-1 overflow-hidden">
        {editorComponent}
      </div>
    );
  }

  // Fallback while loading
  return (
    <pre className="flex-1 overflow-auto p-3 text-[12px] leading-relaxed text-text-secondary bg-bg-primary m-0 border-0 rounded-none">
      {content}
    </pre>
  );
}

// =========================================
// Tab Bar
// =========================================

function TabBar({
  tabs,
  activeTabPath,
  onTabSelect,
  onTabClose,
  gitStatus,
  cwd,
}: {
  tabs: OpenTab[];
  activeTabPath: string | null;
  onTabSelect: (path: string) => void;
  onTabClose: (path: string) => void;
  gitStatus?: Record<string, string>;
  cwd: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Get git status for a tab
  const getTabGitStatus = useCallback((filePath: string) => {
    if (!gitStatus) return undefined;
    const relative = filePath
      .replace(cwd, "")
      .replace(/^[\\/]+/, "")
      .replace(/\\/g, "/");
    return gitStatus[relative];
  }, [gitStatus, cwd]);

  if (tabs.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="flex bg-bg-secondary border-b border-border overflow-x-auto scrollbar-none"
    >
      {tabs.map((tab) => {
        const isActive = tab.path === activeTabPath;
        const status = getTabGitStatus(tab.path);
        return (
          <div
            key={tab.path}
            className={`flex items-center gap-1 px-3 py-1.5 text-[11px] cursor-pointer border-r border-border flex-shrink-0 group ${
              isActive
                ? "bg-bg-primary text-text-primary border-t-2 border-t-accent"
                : "bg-bg-secondary text-text-muted hover:bg-bg-tertiary border-t-2 border-t-transparent"
            }`}
            onClick={() => onTabSelect(tab.path)}
          >
            <FileIcon isDirectory={false} name={tab.name} />
            <span className={`truncate max-w-[120px] ${status ? gitStatusColor(status) : ""}`}>
              {tab.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.path);
              }}
              className={`ml-1 flex-shrink-0 rounded hover:bg-bg-hover p-0.5 ${
                isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
              }`}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// =========================================
// Main ExplorerPanel
// =========================================

export default memo(function ExplorerPanel({ cwd, onFileSelect }: ExplorerPanelProps) {
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [tabContents, setTabContents] = useState<Map<string, { content: string; language: string }>>(new Map());
  const [treeWidth, setTreeWidth] = useState(40);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const activeTabPathRef = useRef<string | null>(null);
  const [gitStatus, setGitStatus] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // Reset when cwd changes
  useEffect(() => {
    setOpenTabs([]);
    setActiveTabPath(null);
    setTabContents(new Map());
  }, [cwd]);

  // Keep ref in sync
  useEffect(() => {
    activeTabPathRef.current = activeTabPath;
  }, [activeTabPath]);

  // Fetch git status
  const fetchGitStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/git-status?dir=${encodeURIComponent(cwd)}`);
      const data = await res.json();
      if (data.files) {
        gitStatusCache.set(cwd, data.files);
        setGitStatus(data.files);
      }
    } catch {
      // Not a git repo or error
    }
  }, [cwd]);

  useEffect(() => {
    fetchGitStatus();
  }, [fetchGitStatus]);

  // SSE file watcher (debounced to prevent excessive API calls)
  const [sseStatus, setSseStatus] = useState<"connected" | "reconnecting" | "disconnected">("connected");
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gitStatusDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const MAX_RETRIES = 5;
    const REFRESH_DEBOUNCE_MS = 1000;  // Debounce file tree refresh
    const GIT_DEBOUNCE_MS = 2000;      // Debounce git status (heavier operation)

    function connect() {
      if (cancelled) return;
      es = new EventSource(`/api/watch?dir=${encodeURIComponent(cwd)}`);

      es.onopen = () => {
        retryCount = 0;
        if (!cancelled) setSseStatus("connected");
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "change") {
            // Debounce file tree refresh (coalesce rapid changes)
            if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
            refreshDebounceRef.current = setTimeout(() => {
              if (!cancelled) setRefreshCounter((c) => c + 1);
            }, REFRESH_DEBOUNCE_MS);

            // Debounce git status refresh (even longer delay)
            if (gitStatusDebounceRef.current) clearTimeout(gitStatusDebounceRef.current);
            gitStatusDebounceRef.current = setTimeout(() => {
              if (!cancelled) fetchGitStatus();
            }, GIT_DEBOUNCE_MS);

            // Refresh active tab content if it was modified (immediate, targeted)
            const currentPath = activeTabPathRef.current;
            if (currentPath && Array.isArray(data.files)) {
              const normalizedCurrent = currentPath.replace(/\\/g, "/");
              const wasModified = data.files.some(
                (f: string) => f.replace(/\\/g, "/") === normalizedCurrent
              );
              if (wasModified) {
                fetch(`/api/file-content?path=${encodeURIComponent(currentPath)}`)
                  .then((res) => res.json())
                  .then((d) => {
                    setTabContents((prev) => {
                      const next = new Map(prev);
                      next.set(currentPath, {
                        content: d.content || d.error || "",
                        language: d.language || "text",
                      });
                      return next;
                    });
                  })
                  .catch(() => {});
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      es.onerror = () => {
        es?.close();
        if (cancelled) return;
        if (retryCount < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 16000);
          retryCount++;
          setSseStatus("reconnecting");
          retryTimer = setTimeout(connect, delay);
        } else {
          setSseStatus("disconnected");
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      if (gitStatusDebounceRef.current) clearTimeout(gitStatusDebounceRef.current);
    };
  }, [cwd, fetchGitStatus]);

  // Open file in tab
  const handleFileSelect = useCallback(async (filePath: string) => {
    onFileSelect?.(filePath);

    // Check if tab already exists
    const existingTab = openTabs.find(t => t.path === filePath);
    if (existingTab) {
      setActiveTabPath(filePath);
      return;
    }

    const fileName = filePath.split(/[\\/]/).pop() || "";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";

    // Add new tab
    const newTab: OpenTab = { path: filePath, name: fileName, language: ext };
    setOpenTabs((prev) => [...prev, newTab]);
    setActiveTabPath(filePath);

    // Fetch content if not cached
    if (!tabContents.has(filePath)) {
      try {
        const res = await fetch(`/api/file-content?path=${encodeURIComponent(filePath)}`);
        const data = await res.json();
        setTabContents((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            content: data.content || data.error || "",
            language: data.language || "text",
          });
          return next;
        });
      } catch {
        setTabContents((prev) => {
          const next = new Map(prev);
          next.set(filePath, { content: "Failed to load file", language: "text" });
          return next;
        });
      }
    }
  }, [onFileSelect, openTabs, tabContents]);

  const handleTabSelect = useCallback((path: string) => {
    setActiveTabPath(path);
  }, []);

  const handleTabClose = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter(t => t.path !== path);
      // If closing active tab, switch to next tab
      if (activeTabPath === path) {
        const closedIndex = prev.findIndex(t => t.path === path);
        const newActive = next[Math.min(closedIndex, next.length - 1)]?.path || null;
        setActiveTabPath(newActive);
      }
      return next;
    });
    // Clean up content cache
    setTabContents((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  }, [activeTabPath]);

  // Drag handle for resizing
  const handleMouseDown = useCallback(() => {
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setTreeWidth(Math.min(70, Math.max(15, pct)));
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileItem) => {
    const items: ContextMenuItem[] = [];
    if (!item.isDirectory) {
      items.push({
        label: "Open in Tab",
        onClick: () => handleFileSelect(item.path),
      });
    }
    items.push({
      label: "Copy Path",
      onClick: () => navigator.clipboard.writeText(item.path),
    });
    items.push({
      label: "Copy Relative Path",
      onClick: () => {
        const relative = item.path.replace(cwd, "").replace(/^[\\/]+/, "").replace(/\\/g, "/");
        navigator.clipboard.writeText(relative);
      },
    });
    if (item.isDirectory) {
      items.push({
        label: "Refresh",
        separator: true,
        onClick: () => {
          fileCache.delete(item.path);
          setRefreshCounter((c) => c + 1);
        },
      });
    }
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [cwd, handleFileSelect]);

  const hasOpenTabs = openTabs.length > 0;
  const activeContent = activeTabPath ? tabContents.get(activeTabPath) : null;
  const activeTab = useMemo(() => openTabs.find(t => t.path === activeTabPath), [openTabs, activeTabPath]);

  return (
    <div className="flex h-full" ref={containerRef}>
      {/* File tree */}
      <div
        className="overflow-y-auto border-r border-border flex-shrink-0"
        style={{ width: hasOpenTabs ? `${treeWidth}%` : "100%" }}
      >
        <div className="flex items-center gap-1.5 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Explorer</span>
          {sseStatus === "reconnecting" && (
            <span className="text-[9px] text-yellow-400" title="Reconnecting file watcher...">
              <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" className="animate-spin inline">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a5 5 0 110 10A5 5 0 018 3z" opacity="0.3" />
                <path d="M8 1a7 7 0 017 7h-2a5 5 0 00-5-5V1z" />
              </svg>
            </span>
          )}
          {sseStatus === "disconnected" && (
            <span className="text-[9px] text-red-400" title="File watcher disconnected">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="3" /></svg>
            </span>
          )}
        </div>
        <FolderTree
          dir={cwd}
          depth={0}
          onFileSelect={handleFileSelect}
          selectedFile={activeTabPath}
          refreshCounter={refreshCounter}
          gitStatus={gitStatus}
          cwd={cwd}
          onContextMenu={handleContextMenu}
        />
      </div>

      {/* Drag handle */}
      {hasOpenTabs && (
        <div
          onMouseDown={handleMouseDown}
          className="w-1 hover:w-1 bg-border hover:bg-accent/50 cursor-col-resize transition-colors flex-shrink-0"
        />
      )}

      {/* Editor area */}
      {hasOpenTabs && (
        <div className="flex-1 flex flex-col min-w-0 bg-bg-primary">
          {/* Tab bar */}
          <TabBar
            tabs={openTabs}
            activeTabPath={activeTabPath}
            onTabSelect={handleTabSelect}
            onTabClose={handleTabClose}
            gitStatus={gitStatus}
            cwd={cwd}
          />

          {/* Editor content */}
          {activeTab && activeContent ? (
            <CodeMirrorPreview
              key={activeTab.path}
              content={activeContent.content}
              fileName={activeTab.name}
            />
          ) : activeTab ? (
            <div className="flex-1 flex items-center justify-center text-xs text-text-muted">Loading...</div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
              Select a file to preview
            </div>
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});
