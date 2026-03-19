"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SearchResult {
  name: string;
  path: string;
  relativePath: string;
}

interface FileSearchModalProps {
  cwd: string;
  onSelect: (filePath: string) => void;
  onClose: () => void;
}

export default function FileSearchModal({ cwd, onSelect, onClose }: FileSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Search with debounce
  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/file-search?dir=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
      setSelectedIndex(0);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, [cwd]);

  const handleInputChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 150);
  }, [search]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        onSelect(results[selectedIndex].path);
        onClose();
      }
    }
  }, [results, selectedIndex, onSelect, onClose]);

  // Highlight matching parts in file name
  const highlightMatch = (text: string, q: string) => {
    if (!q) return text;
    const lower = text.toLowerCase();
    const qLower = q.toLowerCase();
    const idx = lower.indexOf(qLower);
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="text-accent font-semibold">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className="w-[500px] max-w-[90vw] bg-bg-tertiary border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted flex-shrink-0">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files by name..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          />
          {loading && (
            <span className="w-3 h-3 border-[1.5px] border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto">
          {results.length === 0 && query && !loading && (
            <div className="px-4 py-6 text-center text-xs text-text-muted">No files found</div>
          )}
          {results.map((result, i) => {
            const dirPath = result.relativePath.includes("/")
              ? result.relativePath.slice(0, result.relativePath.lastIndexOf("/"))
              : "";
            return (
              <button
                key={result.path}
                onClick={() => { onSelect(result.path); onClose(); }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex items-center gap-3 w-full text-left px-4 py-2 transition-colors ${
                  i === selectedIndex ? "bg-accent/10" : "hover:bg-bg-hover"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="#8b8b8b" className="flex-shrink-0" opacity="0.6">
                  <path d="M3 1h7l3 3v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">
                    {highlightMatch(result.name, query)}
                  </div>
                  {dirPath && (
                    <div className="text-[10px] text-text-muted truncate">{dirPath}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-text-muted">
          <span><kbd className="px-1 py-0.5 bg-bg-secondary rounded text-[9px]">↑↓</kbd> Navigate</span>
          <span><kbd className="px-1 py-0.5 bg-bg-secondary rounded text-[9px]">Enter</kbd> Open</span>
          <span><kbd className="px-1 py-0.5 bg-bg-secondary rounded text-[9px]">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
