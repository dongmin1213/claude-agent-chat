"use client";

import { useState, useEffect } from "react";
import ImageModal from "./ImageModal";

interface ToolBlockProps {
  toolName: string;
  input: Record<string, unknown>;
  isRunning: boolean;
  result?: { content: string; isError: boolean; images?: string[] } | null;
}

// TodoWrite types
interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

function parseTodos(input: Record<string, unknown>): TodoItem[] | null {
  const todos = input.todos;
  if (!Array.isArray(todos)) return null;
  return todos.filter(
    (t) => t && typeof t.content === "string" && typeof t.status === "string"
  ) as TodoItem[];
}

function getToolSummary(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "Bash":
      return `$ ${(input.command as string) || "..."}`;
    case "Read":
      return (input.file_path as string) || "Reading file...";
    case "Write":
      return (input.file_path as string) || "Writing file...";
    case "Edit": {
      const filePath = (input.file_path as string) || "Editing file...";
      if (typeof input.old_string === "string" && typeof input.new_string === "string") {
        const addedCount = input.new_string.split("\n").length;
        const removedCount = input.old_string.split("\n").length;
        return `${filePath} (+${addedCount} -${removedCount})`;
      }
      return filePath;
    }
    case "Glob":
      return (input.pattern as string) || "Searching files...";
    case "Grep":
      return `/${(input.pattern as string) || "..."}/ `;
    case "WebSearch":
      return (input.query as string) || "Searching web...";
    case "WebFetch":
      return (input.url as string) || "Fetching URL...";
    case "Task":
      return (input.description as string) || "Running task...";
    case "TodoWrite": {
      const todos = parseTodos(input);
      if (!todos) return "Updating tasks...";
      const done = todos.filter((t) => t.status === "completed").length;
      const active = todos.filter((t) => t.status === "in_progress").length;
      return `${done}/${todos.length} done${active > 0 ? `, ${active} active` : ""}`;
    }
    default:
      return `Running ${toolName}...`;
  }
}

// Diff view for Edit tool
function DiffView({ oldStr, newStr, filePath }: { oldStr: string; newStr: string; filePath?: string }) {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // Find common prefix lines
  let prefixLen = 0;
  while (prefixLen < oldLines.length && prefixLen < newLines.length && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }
  // Find common suffix lines
  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const removedLines = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const addedLines = newLines.slice(prefixLen, newLines.length - suffixLen);

  const addedCount = addedLines.length;
  const removedCount = removedLines.length;

  return (
    <div className="rounded border border-border overflow-hidden text-xs font-mono">
      {/* Header with file name + stats */}
      {filePath && (
        <div className="flex items-center gap-2 px-2.5 py-1 bg-bg-secondary/80 border-b border-border text-text-muted">
          <span className="truncate">{filePath}</span>
          <span className="flex-shrink-0 flex gap-1.5">
            {addedCount > 0 && <span className="text-green-400">+{addedCount}</span>}
            {removedCount > 0 && <span className="text-red-400">-{removedCount}</span>}
          </span>
        </div>
      )}
      <div className="overflow-x-auto max-h-60 overflow-y-auto">
        {/* Context before */}
        {prefixLen > 0 && (
          <div className="text-text-muted/50 px-2 py-0.5 text-[10px]">
            {prefixLen > 2
              ? `... ${prefixLen} unchanged lines ...`
              : oldLines.slice(0, prefixLen).map((line, i) => (
                  <div key={`ctx-pre-${i}`} className="px-1 whitespace-pre">{line || "\u00A0"}</div>
                ))}
          </div>
        )}
        {/* Removed lines */}
        {removedLines.map((line, i) => (
          <div key={`rm-${i}`} className="bg-red-500/10 text-red-300 px-2 py-px whitespace-pre flex">
            <span className="select-none text-red-400/60 w-5 text-right mr-2 flex-shrink-0">-</span>
            <span>{line || "\u00A0"}</span>
          </div>
        ))}
        {/* Added lines */}
        {addedLines.map((line, i) => (
          <div key={`add-${i}`} className="bg-green-500/10 text-green-300 px-2 py-px whitespace-pre flex">
            <span className="select-none text-green-400/60 w-5 text-right mr-2 flex-shrink-0">+</span>
            <span>{line || "\u00A0"}</span>
          </div>
        ))}
        {/* Context after */}
        {suffixLen > 0 && (
          <div className="text-text-muted/50 px-2 py-0.5 text-[10px]">
            {suffixLen > 2
              ? `... ${suffixLen} unchanged lines ...`
              : oldLines.slice(oldLines.length - suffixLen).map((line, i) => (
                  <div key={`ctx-suf-${i}`} className="px-1 whitespace-pre">{line || "\u00A0"}</div>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}

// TodoWrite checklist UI
function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="space-y-1">
      {todos.map((todo, i) => {
        const isCompleted = todo.status === "completed";
        const isActive = todo.status === "in_progress";
        return (
          <div
            key={i}
            className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
              isActive ? "bg-accent/8 border border-accent/20" : ""
            }`}
          >
            {/* Status icon */}
            <span className="flex-shrink-0 mt-0.5">
              {isCompleted ? (
                <svg width="14" height="14" viewBox="0 0 16 16" className="text-success">
                  <rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4.5 8l2.5 2.5L11.5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : isActive ? (
                <span className="w-3.5 h-3.5 border-[1.5px] border-accent border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" className="text-text-muted">
                  <rect x="1" y="1" width="14" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              )}
            </span>
            {/* Text */}
            <span className={`flex-1 leading-relaxed ${
              isCompleted
                ? "text-text-muted line-through"
                : isActive
                  ? "text-accent font-medium"
                  : "text-text-secondary"
            }`}>
              {isActive ? todo.activeForm : todo.content}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SmartInput({ toolName, input }: { toolName: string; input: Record<string, unknown> }) {
  // TodoWrite → render checklist
  if (toolName === "TodoWrite") {
    const todos = parseTodos(input);
    if (todos) return <TodoList todos={todos} />;
  }
  // Edit tool with old_string and new_string → show diff view
  if (toolName === "Edit" && typeof input.old_string === "string" && typeof input.new_string === "string") {
    return (
      <DiffView
        oldStr={input.old_string}
        newStr={input.new_string}
        filePath={input.file_path as string | undefined}
      />
    );
  }
  if (toolName === "Bash" && input.command) {
    return (
      <div className="font-mono text-xs text-text-secondary bg-bg-primary rounded px-2.5 py-2 overflow-x-auto">
        <span className="text-text-muted select-none">$ </span>
        {input.command as string}
      </div>
    );
  }
  if ((toolName === "Read" || toolName === "Write" || toolName === "Edit") && input.file_path) {
    return (
      <div className="text-xs text-text-secondary font-mono truncate px-1">
        {input.file_path as string}
      </div>
    );
  }
  if (toolName === "Glob" && input.pattern) {
    return (
      <div className="text-xs text-text-secondary font-mono truncate px-1">
        {input.pattern as string}
      </div>
    );
  }
  if (toolName === "Grep" && input.pattern) {
    return (
      <div className="text-xs text-text-secondary font-mono truncate px-1">
        /{input.pattern as string}/
      </div>
    );
  }
  return (
    <pre className="text-xs text-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

// Elapsed time for running tools
function RunningElapsed() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, []);
  if (elapsed < 1000) return null;
  const sec = Math.floor(elapsed / 1000);
  return (
    <span className="text-[10px] text-accent tabular-nums flex-shrink-0 ml-auto">
      {sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`}
    </span>
  );
}

function CopySmall({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="text-[10px] text-text-muted hover:text-text-primary transition-colors flex items-center gap-0.5"
    >
      {copied ? (
        <>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 8.5l3.5 3.5L13 4" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5" y="5" width="8" height="8" rx="1" />
            <path d="M3 11V3a1 1 0 011-1h8" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

export default function ToolBlock({
  toolName,
  input,
  isRunning,
  result,
}: ToolBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [modalImage, setModalImage] = useState<string | null>(null);
  const summary = getToolSummary(toolName, input);

  // --- TodoWrite: always show checklist (never collapsed to single line) ---
  if (toolName === "TodoWrite") {
    const todos = parseTodos(input);
    if (todos) {
      const done = todos.filter((t) => t.status === "completed").length;
      const total = todos.length;
      return (
        <div className="my-1.5 rounded-lg border border-border overflow-hidden bg-bg-secondary">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-bg-hover transition-colors"
          >
            {/* Checklist icon */}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent flex-shrink-0">
              <path d="M2 4h12M2 8h12M2 12h12" strokeOpacity="0.3" />
              <path d="M1 3.5l1.5 1.5L5 2" />
              <path d="M1 7.5l1.5 1.5L5 6" />
              <rect x="1" y="11" width="3.5" height="3" rx="0.5" fill="none" />
            </svg>
            <span className="font-medium text-text-primary">Tasks</span>
            {/* Progress */}
            <div className="flex items-center gap-1.5 flex-1">
              <div className="h-1.5 flex-1 max-w-[80px] rounded-full bg-bg-primary overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
                />
              </div>
              <span className="text-text-muted text-[10px] tabular-nums">{done}/{total}</span>
            </div>
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
              className={`flex-shrink-0 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              <path d="M3 4l2 2 2-2" />
            </svg>
          </button>
          {/* Todo list — shown by default, collapsible */}
          <div className={`border-t border-border px-2 py-1.5 ${expanded ? "hidden" : ""}`}>
            <TodoList todos={todos} />
          </div>
        </div>
      );
    }
  }

  // --- Collapsed: ultra-compact single line ---
  if (!expanded) {
    return (
      <div>
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 py-0.5 pl-2 w-full text-left border-l-2 border-accent/30 hover:border-accent/60 hover:bg-bg-hover/50 transition-colors rounded-r-sm group"
        >
          {/* Status icon */}
          {isRunning ? (
            <span className="w-3 h-3 border-[1.5px] border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
          ) : result?.isError ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-error flex-shrink-0">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-success flex-shrink-0">
              <path d="M3 8.5l3.5 3.5L13 4" />
            </svg>
          )}

          {/* Tool name */}
          <span className="text-[11px] text-text-muted flex-shrink-0">{toolName}</span>

          {/* Summary */}
          <span className="text-[11px] text-text-secondary font-mono truncate">
            {summary}
          </span>

          {/* Elapsed time for running tools */}
          {isRunning && <RunningElapsed />}

          {/* Expand hint on hover */}
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
            className="flex-shrink-0 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
          >
            <path d="M3 4l2 2 2-2" />
          </svg>
        </button>
        {/* Show images outside collapsed tool for quick preview (skip for Read tool - image already visible in user message) */}
        {result?.images && result.images.length > 0 && toolName !== "Read" && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {result.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={`${toolName} result ${i + 1}`}
                className="max-w-full max-h-96 rounded-lg border border-border object-contain cursor-pointer hover:opacity-90 transition-opacity"
                loading="lazy"
                onClick={() => setModalImage(src)}
              />
            ))}
          </div>
        )}
        {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
      </div>
    );
  }

  // --- Expanded: full details ---
  return (
    <div className="my-1 rounded-lg border border-border overflow-hidden bg-bg-secondary">
      {/* Header */}
      <button
        onClick={() => setExpanded(false)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-bg-hover transition-colors"
      >
        {/* Status */}
        {isRunning ? (
          <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
        ) : result?.isError ? (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-error flex-shrink-0">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-success flex-shrink-0">
            <path d="M3 8.5l3.5 3.5L13 4" />
          </svg>
        )}

        <span className="font-medium text-text-primary">{toolName}</span>
        <span className="text-text-muted truncate flex-1 text-left font-mono">
          {summary}
        </span>

        {/* Collapse chevron */}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
          className="flex-shrink-0 text-text-muted rotate-180"
        >
          <path d="M3 4l2 2 2-2" />
        </svg>
      </button>

      {/* Details */}
      <div className="border-t border-border px-3 py-2 space-y-2">
        {/* Input */}
        {Object.keys(input).length > 0 && (
          <div>
            <div className="text-xs text-text-muted mb-1 font-semibold">
              Input
            </div>
            <SmartInput toolName={toolName} input={input} />
          </div>
        )}

        {/* Result */}
        {result && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <div
                className={`text-xs font-semibold ${
                  result.isError ? "text-error" : "text-text-muted"
                }`}
              >
                {result.isError ? "Error" : "Output"}
              </div>
              {result.content && <CopySmall text={result.content} />}
            </div>
            {/* Images from tool results (e.g. screenshots) - skip for Read tool */}
            {result.images && result.images.length > 0 && toolName !== "Read" && (
              <div className="flex flex-wrap gap-2 mb-2">
                {result.images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt={`tool result image ${i + 1}`}
                    className="max-w-full max-h-96 rounded-lg border border-border object-contain cursor-pointer hover:opacity-90 transition-opacity"
                    loading="lazy"
                    onClick={() => setModalImage(src)}
                  />
                ))}
              </div>
            )}
            {result.content && (
              <pre
                className={`text-xs whitespace-pre-wrap break-all max-h-80 overflow-y-auto ${
                  result.isError ? "text-error/80" : "text-text-secondary"
                }`}
              >
                {result.content}
              </pre>
            )}
            {!result.content && !result.images?.length && (
              <pre className="text-xs text-text-secondary">(empty)</pre>
            )}
          </div>
        )}
      </div>
      {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
    </div>
  );
}
