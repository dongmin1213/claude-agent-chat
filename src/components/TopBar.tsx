"use client";

import { useState, useRef, useEffect, memo } from "react";
import FolderPicker from "./FolderPicker";

const MODELS = [
  { id: "sonnet", label: "Sonnet 4.6" },
  { id: "opus", label: "Opus 4.6" },
  { id: "haiku", label: "Haiku 4.5" },
];

interface TopBarProps {
  model: string;
  onModelChange: (model: string) => void;
  cwd: string;
  onCwdChange: (cwd: string) => void;
  terminalOpen?: boolean;
  onTerminalToggle?: () => void;
  onMenuClick?: () => void;
  /** Optional title text displayed in the center (used by chat windows) */
  title?: string;
}

// Electron API type declaration
declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
      zoomIn: () => Promise<number>;
      zoomOut: () => Promise<number>;
      zoomReset: () => Promise<number>;
      zoomGet: () => Promise<number>;
      openChatWindow: (chatId: string) => Promise<void>;
      closeChatWindow: (chatId: string) => Promise<void>;
      setWindowTitle: (title: string) => Promise<void>;
      platform: string;
    };
  }
}

export default memo(function TopBar({
  model,
  onModelChange,
  cwd,
  onCwdChange,
  terminalOpen,
  onTerminalToggle,
  onMenuClick,
  title,
}: TopBarProps) {
  const [modelOpen, setModelOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);
  const cwdBtnRef = useRef<HTMLButtonElement>(null);

  const isElectron = typeof window !== "undefined" && !!window.electronAPI;
  const selectedModel = MODELS.find((m) => m.id === model) || MODELS[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Electron: track maximize state
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI!.isMaximized().then(setIsMaximized);
    const cleanup = window.electronAPI!.onMaximizeChange(setIsMaximized);
    return cleanup;
  }, [isElectron]);

  const cwdLabel = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary/50 min-h-[40px]"
      style={isElectron ? { WebkitAppRegion: "drag" } as React.CSSProperties : undefined}
    >
      {/* Mobile menu button (browser mode only) */}
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="text-text-secondary hover:text-text-primary md:hidden"
          style={isElectron ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h14M3 10h14M3 14h14" />
          </svg>
        </button>
      )}

      {/* Model selector */}
      <div
        className="relative"
        ref={modelRef}
        style={isElectron ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
      >
        <button
          onClick={() => setModelOpen(!modelOpen)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-tertiary border border-border hover:border-border-light text-xs font-medium text-text-primary transition-colors"
        >
          {selectedModel.label}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-text-muted">
            <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {modelOpen && (
          <div className="absolute top-full left-0 mt-1 w-40 bg-bg-tertiary border border-border rounded-lg shadow-xl z-50 py-1">
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => { onModelChange(m.id); setModelOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors ${
                  m.id === model ? "text-accent font-medium" : "text-text-primary"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* CWD folder picker */}
      <div
        className="relative"
        style={isElectron ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
      >
        <button
          ref={cwdBtnRef}
          onClick={() => setFolderPickerOpen(!folderPickerOpen)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-tertiary border border-border hover:border-border-light text-xs text-text-secondary hover:text-text-primary transition-colors truncate max-w-[200px]"
          title={cwd}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-text-muted">
            <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
          </svg>
          {cwdLabel}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-text-muted">
            <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {folderPickerOpen && (
          <FolderPicker
            cwd={cwd}
            onSelect={onCwdChange}
            onClose={() => setFolderPickerOpen(false)}
            anchorRef={cwdBtnRef}
          />
        )}
      </div>

      {/* Terminal toggle (optional — main window / browser mode only) */}
      {onTerminalToggle && (
        <button
          onClick={onTerminalToggle}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            terminalOpen
              ? "bg-accent/20 text-accent border border-accent/30"
              : "bg-bg-tertiary border border-border hover:border-border-light text-text-secondary hover:text-text-primary"
          }`}
          title="Terminal (Ctrl+`)"
          style={isElectron ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 5l4 3-4 3" />
            <path d="M9 12h4" />
          </svg>
          Terminal
        </button>
      )}

      {/* Title (centered, for chat windows) */}
      {title && (
        <div className="flex-1 text-center text-xs text-text-secondary truncate px-2">{title}</div>
      )}
      {!title && <div className="flex-1" />}

      {/* ── Electron Window Controls ── */}
      {isElectron && (
        <>
          <div className="w-px h-4 bg-border mx-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} />

          {/* Minimize */}
          <button
            onClick={() => window.electronAPI!.minimize()}
            className="electron-win-btn flex items-center justify-center w-[34px] h-[26px] rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            title="Minimize"
            aria-label="Minimize window"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>

          {/* Maximize / Restore */}
          <button
            onClick={() => window.electronAPI!.maximize()}
            className="electron-win-btn flex items-center justify-center w-[34px] h-[26px] rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            title={isMaximized ? "Restore" : "Maximize"}
            aria-label={isMaximized ? "Restore window" : "Maximize window"}
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

          {/* Close */}
          <button
            onClick={() => window.electronAPI!.close()}
            className="electron-win-btn electron-close-btn flex items-center justify-center w-[34px] h-[26px] rounded hover:bg-red-600 text-text-muted hover:text-white transition-colors"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            title="Close"
            aria-label="Close window"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
});
