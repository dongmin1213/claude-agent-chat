"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface FolderItem {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FolderPickerProps {
  cwd: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

// Simple in-memory cache for directory listings
const dirCache = new Map<string, FolderItem[]>();

export default function FolderPicker({ cwd, onSelect, onClose, anchorRef }: FolderPickerProps & { anchorRef?: React.RefObject<HTMLElement | null> }) {
  const [currentDir, setCurrentDir] = useState(cwd);
  const [items, setItems] = useState<FolderItem[]>(() => dirCache.get(cwd) || []);
  const [loading, setLoading] = useState(!dirCache.has(cwd));
  const [pathInput, setPathInput] = useState(cwd);
  const [pathError, setPathError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Position the picker below the anchor button, clamped to viewport
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    function update() {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const pickerW = Math.min(384, window.innerWidth - 16);
      let left = rect.left;
      // Prevent right overflow
      if (left + pickerW > window.innerWidth - 8) {
        left = window.innerWidth - 8 - pickerW;
      }
      if (left < 8) left = 8;
      setPos({ top: rect.bottom + 4, left });
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchorRef]);

  const load = useCallback(async (dir: string) => {
    // Show cached data immediately if available
    const cached = dirCache.get(dir);
    if (cached) {
      setItems(cached);
      setCurrentDir(dir);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setCurrentDir(dir);

    try {
      const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}&dirsOnly=true`);
      if (!res.ok) {
        if (!cached) setItems([]);
        setPathError(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      const folders = data.items || [];
      dirCache.set(dir, folders);
      setItems(folders);
      const resolvedDir = data.cwd || dir;
      setCurrentDir(resolvedDir);
      setPathInput(resolvedDir);
      setPathError(false);
    } catch {
      if (!cached) setItems([]);
      setPathError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(cwd); }, [cwd, load]);

  const closingRef = useRef(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (closingRef.current) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const parentDir = currentDir.replace(/[\\/][^\\/]+$/, "") || (currentDir.includes(":") ? currentDir.slice(0, 3) : "/");

  const dirParts = currentDir.split(/[\\/]/).filter(Boolean);

  return (
    <div ref={ref} style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, width: Math.min(384, typeof window !== "undefined" ? window.innerWidth - 16 : 384) }} className={`bg-bg-tertiary border border-border rounded-lg shadow-2xl z-[9999] overflow-hidden${pos ? "" : " invisible"}`}>
      {/* Path input */}
      <div className="px-3 py-2 border-b border-border bg-bg-secondary/50">
        <div className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-text-muted">
            <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={pathInput}
            onChange={(e) => { setPathInput(e.target.value); setPathError(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const trimmed = pathInput.trim();
                if (trimmed) load(trimmed);
              }
            }}
            className={`flex-1 bg-bg-primary border rounded px-2 py-1 text-[11px] text-text-primary outline-none transition-colors ${
              pathError ? "border-red-500" : "border-border focus:border-accent"
            }`}
            placeholder="경로를 직접 입력하세요 (Enter)"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {pathError && (
          <p className="text-[10px] text-red-400 mt-1 ml-[18px]">경로를 찾을 수 없습니다</p>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border overflow-x-auto">
        {dirParts.map((part, i) => {
          const fullPath = dirParts.slice(0, i + 1).join("\\");
          // On Windows, first part needs the backslash (e.g., "C:\")
          const navPath = i === 0 ? part + "\\" : fullPath;
          return (
            <span key={i} className="flex items-center gap-0.5 flex-shrink-0">
              {i > 0 && <span className="text-text-muted text-[10px] mx-0.5">/</span>}
              <button
                onClick={() => load(navPath)}
                className="text-[11px] text-text-secondary hover:text-accent transition-colors truncate max-w-[80px]"
                title={part}
              >
                {part}
              </button>
            </span>
          );
        })}
      </div>

      {/* Folder list */}
      <div className="max-h-[280px] overflow-y-auto">
        {/* Go up */}
        {parentDir !== currentDir && (
          <button
            onClick={() => load(parentDir)}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors text-text-secondary"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
              <path d="M8 12V4M4 8l4-4 4 4" />
            </svg>
            <span>..</span>
          </button>
        )}

        {loading && items.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-muted text-center">Loading...</div>
        ) : items.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-muted text-center">No subfolders</div>
        ) : (
          items.map((item) => (
            <button
              key={item.path}
              onClick={() => load(item.path)}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors text-text-primary"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="#e8a838" className="flex-shrink-0">
                <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
              </svg>
              <span className="truncate">{item.name}</span>
            </button>
          ))
        )}
      </div>

      {/* Select button */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-bg-secondary/50">
        <span className="text-[10px] text-text-muted truncate flex-1 mr-2" title={currentDir}>
          {currentDir}
        </span>
        <button
          onClick={() => { closingRef.current = true; onSelect(currentDir); onClose(); }}
          className="px-3 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-hover transition-colors flex-shrink-0"
        >
          Select
        </button>
      </div>
    </div>
  );
}
