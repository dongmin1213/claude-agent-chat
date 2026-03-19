"use client";

import { useEffect, useRef, useMemo, useState, useCallback, memo } from "react";
import type { UIMessage, ToolResultMessage, ToolUseMessage, PlanApprovalMessage, AskUserMessage, AssistantTextMessage } from "@/types/chat";
import MessageBubble from "./MessageBubble";
import ToolBlock from "./ToolBlock";
import ImageModal from "./ImageModal";
import PlanApprovalBlock from "./PlanApprovalBlock";
import AskUserBlock from "./AskUserBlock";

// Loading skeleton shown while switching chats
function ChatSkeleton() {
  return (
    <div className="flex-1 p-6 space-y-6 animate-pulse" aria-label="Loading chat...">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* User message skeleton */}
        <div className="flex justify-end">
          <div className="space-y-2 max-w-[70%]">
            <div className="skeleton h-4 w-48 ml-auto" />
            <div className="skeleton h-10 w-64 rounded-2xl ml-auto" />
          </div>
        </div>
        {/* Assistant message skeleton */}
        <div className="flex justify-start">
          <div className="space-y-2 max-w-[80%]">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-24 w-96 rounded-2xl" />
            <div className="skeleton h-4 w-72" />
          </div>
        </div>
        {/* Tool block skeleton */}
        <div className="space-y-1">
          <div className="skeleton h-6 w-80 rounded" />
          <div className="skeleton h-6 w-64 rounded" />
        </div>
        {/* Another assistant message */}
        <div className="flex justify-start">
          <div className="space-y-2 max-w-[80%]">
            <div className="skeleton h-4 w-40" />
            <div className="skeleton h-16 w-80 rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

const SUGGESTED_PROMPTS = [
  { icon: "\uD83D\uDCDD", label: "Explain this codebase", prompt: "Read the project structure and give me a high-level overview of this codebase." },
  { icon: "\uD83D\uDC1B", label: "Find and fix bugs", prompt: "Search for potential bugs or issues in the codebase and suggest fixes." },
  { icon: "\uD83D\uDD27", label: "Refactor code", prompt: "Identify areas that could benefit from refactoring and implement improvements." },
  { icon: "\uD83D\uDCD6", label: "Write documentation", prompt: "Generate comprehensive documentation for the key modules in this project." },
];

interface ChatAreaProps {
  messages: UIMessage[];
  isLoading: boolean;
  isStreamConnected?: boolean;
  loadingStartTime?: number;
  statusMessage?: string;
  onSendPrompt?: (prompt: string) => void;
  onBranchChat?: (messageIndex: number) => void;
  onPlanApproval?: (approved: boolean, feedback?: string) => void;
  onAskUserAnswer?: (answers: Record<string, string>) => void;
  onTogglePin?: (messageId: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: () => void;
  onRetry?: () => void;
  chatCost?: number;
  chatDuration?: number;
  chatInputTokens?: number;
  chatOutputTokens?: number;
  chatTurnCount?: number;
  searchOpen?: boolean;
  onSearchClose?: () => void;
  /** Show skeleton while loading chat data */
  isLoadingChat?: boolean;
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec.toString().padStart(2, "0")}s`;
}

// KakaoTalk-style typing bubble indicator
function ThinkingIndicator({ isStreamConnected, loadingStartTime, statusMessage }: { isStreamConnected: boolean; loadingStartTime: number; statusMessage?: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!loadingStartTime) return;
    const timer = setInterval(() => {
      setElapsed(Date.now() - loadingStartTime);
    }, 1000);
    return () => clearInterval(timer);
  }, [loadingStartTime]);

  const elapsedSec = Math.floor(elapsed / 1000);
  const isSlowConnect = !isStreamConnected && elapsedSec > 30;

  // Pre-connection warning (keep text-based)
  if (!isStreamConnected && isSlowConnect) {
    return (
      <div className="flex items-center gap-2 mb-4 px-1 py-2">
        <span className="w-3 h-3 border-[1.5px] border-yellow-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <span className="text-xs text-yellow-500">Connecting... ({formatElapsed(elapsed)}) — service may be slow</span>
      </div>
    );
  }

  return (
    <div className="mb-4 px-1">
      {/* Chat bubble with bouncing dots */}
      <div className="inline-flex items-center gap-1.5 bg-bg-tertiary rounded-2xl rounded-tl-sm px-4 py-3 border border-border/50">
        {statusMessage ? (
          // Status message (auto-compact, etc.) inside bubble
          <span className="text-xs text-accent">{statusMessage}</span>
        ) : !isStreamConnected ? (
          // Connecting state
          <span className="text-xs text-text-muted">Connecting...</span>
        ) : (
          // Bouncing dots (default thinking state)
          <>
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </>
        )}
      </div>
      {/* Elapsed time below bubble */}
      {elapsedSec > 3 && (
        <div className="text-[10px] text-text-muted mt-1 ml-1 opacity-60">
          {formatElapsed(elapsed)}
        </div>
      )}
    </div>
  );
}

// =========================================
// SearchBar (in-conversation search)
// =========================================

function SearchBar({
  messages,
  isOpen,
  onClose,
  scrollContainerRef,
}: {
  messages: UIMessage[];
  isOpen: boolean;
  onClose: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Collect searchable message indices & their DOM ids
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const results: { messageId: string; preview: string }[] = [];
    for (const msg of messages) {
      const content = (msg as { content?: string }).content;
      if (content && typeof content === "string" && content.toLowerCase().includes(q)) {
        const idx = content.toLowerCase().indexOf(q);
        const start = Math.max(0, idx - 30);
        const end = Math.min(content.length, idx + query.length + 30);
        const preview = (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "");
        results.push({ messageId: msg.id, preview });
      }
    }
    return results;
  }, [query, messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setCurrentMatch(0);
    }
  }, [isOpen]);

  // Reset currentMatch when matches change
  useEffect(() => {
    if (currentMatch >= matches.length) setCurrentMatch(0);
  }, [matches, currentMatch]);

  const scrollToMatch = useCallback((index: number) => {
    if (matches.length === 0) return;
    const match = matches[index];
    if (!match) return;
    // Find the DOM element by message id
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-message-id="${match.messageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Flash highlight
      el.classList.add("ring-2", "ring-accent", "ring-offset-1", "ring-offset-bg-primary");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-accent", "ring-offset-1", "ring-offset-bg-primary");
      }, 1500);
    }
  }, [matches, scrollContainerRef]);

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    const next = (currentMatch + 1) % matches.length;
    setCurrentMatch(next);
    scrollToMatch(next);
  }, [currentMatch, matches, scrollToMatch]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    const prev = (currentMatch - 1 + matches.length) % matches.length;
    setCurrentMatch(prev);
    scrollToMatch(prev);
  }, [currentMatch, matches, scrollToMatch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter") {
      if (e.shiftKey) goPrev();
      else goNext();
    }
  }, [onClose, goNext, goPrev]);

  // Auto-scroll to first match on query change
  useEffect(() => {
    if (matches.length > 0) {
      scrollToMatch(0);
      setCurrentMatch(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (!isOpen) return null;

  return (
    <div className="sticky top-0 z-20 bg-bg-secondary/95 backdrop-blur-sm border-b border-border px-4 py-2">
      <div className="max-w-3xl mx-auto flex items-center gap-2">
        {/* Search icon */}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted flex-shrink-0">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        {/* Input */}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search in conversation..."
          className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {/* Match count */}
        {query.trim() && (
          <span className="text-[10px] text-text-muted tabular-nums flex-shrink-0">
            {matches.length > 0
              ? `${currentMatch + 1} / ${matches.length}`
              : "No results"}
          </span>
        )}
        {/* Nav buttons */}
        {matches.length > 1 && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={goPrev} className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" title="Previous (Shift+Enter)">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M7 8L5 6 7 4" transform="rotate(-90 5 5)" />
              </svg>
            </button>
            <button onClick={goNext} className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" title="Next (Enter)">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 2l2 2-2 2" transform="rotate(90 5 5)" />
              </svg>
            </button>
          </div>
        )}
        {/* Close */}
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors flex-shrink-0" title="Close (Esc)">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// =========================================
// PinnedStrip
// =========================================

function PinnedStrip({
  pinnedMessages,
  onTogglePin,
  scrollContainerRef,
}: {
  pinnedMessages: UIMessage[];
  onTogglePin?: (messageId: string) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [expanded, setExpanded] = useState(false);

  const scrollToMessage = (messageId: string) => {
    const container = scrollContainerRef?.current;
    if (!container) return;
    const el = container.querySelector(`[data-message-id="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Brief highlight effect
      el.classList.add("ring-2", "ring-accent/40", "rounded-lg");
      setTimeout(() => el.classList.remove("ring-2", "ring-accent/40", "rounded-lg"), 1500);
    }
  };

  return (
    <div className="border border-accent/20 rounded-xl bg-accent-dim/10 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent-dim/20 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" strokeWidth="0.5" className="text-accent flex-shrink-0">
          <path d="M9.5 2L14 6.5l-3 1-2.5 3L7 12l-1-2-3.5-1 3-2.5 1-3z" />
          <path d="M5 11L2 14" fill="none" strokeWidth="1.5" />
        </svg>
        <span className="text-xs font-medium text-accent">
          {pinnedMessages.length} pinned message{pinnedMessages.length !== 1 ? "s" : ""}
        </span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
          className={`ml-auto text-accent transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M3 4l2 2 2-2" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-accent/10 px-3 py-2 space-y-1 max-h-64 overflow-y-auto">
          {pinnedMessages.map((msg) => {
            const content = (msg as { content?: string }).content || "";
            const preview = content.length > 120 ? content.slice(0, 120) + "..." : content;
            return (
              <div
                key={msg.id}
                className="flex items-start gap-2 group/pin cursor-pointer hover:bg-accent-dim/20 rounded-lg px-2 py-1.5 -mx-1 transition-colors"
                onClick={() => scrollToMessage(msg.id)}
              >
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0 ${
                  msg.role === "user"
                    ? "bg-accent-dim/30 text-accent"
                    : "bg-bg-tertiary text-text-secondary"
                }`}>
                  {msg.role === "user" ? "You" : "AI"}
                </span>
                <p className="text-xs text-text-secondary flex-1 min-w-0 leading-relaxed line-clamp-2">
                  {preview}
                </p>
                {onTogglePin && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onTogglePin(msg.id); }}
                    className="opacity-0 group-hover/pin:opacity-100 text-text-muted hover:text-error text-[10px] flex-shrink-0 mt-0.5 transition-opacity"
                    title="Unpin"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =========================================
// ToolGroup
// =========================================

interface ToolGroupProps {
  toolMessages: UIMessage[];
  toolResults: Map<string, ToolResultMessage>;
  hasRunningTool: boolean;
}

function ToolGroup({ toolMessages, toolResults, hasRunningTool }: ToolGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const [modalImage, setModalImage] = useState<string | null>(null);

  const toolUses = toolMessages.filter((m) => m.role === "tool_use") as ToolUseMessage[];
  const toolCount = toolUses.length;
  const hasError = toolUses.some((t) => {
    const result = toolResults.get(t.toolUseId);
    return result?.isError;
  });

  const toolNameCounts = new Map<string, number>();
  for (const t of toolUses) {
    toolNameCounts.set(t.toolName, (toolNameCounts.get(t.toolName) || 0) + 1);
  }
  const summaryParts: string[] = [];
  for (const [name, count] of toolNameCounts) {
    summaryParts.push(count > 1 ? `${name} ×${count}` : name);
  }
  const summary = summaryParts.join(", ");

  if (toolCount <= 1) {
    return (
      <>
        {toolMessages.map((msg) => {
          if (msg.role === "tool_use") {
            const toolMsg = msg as ToolUseMessage;
            const result = toolResults.get(toolMsg.toolUseId);
            const hideImages = toolMsg.toolName === "Read";
            return (
              <div key={msg.id} className="mb-1">
                <ToolBlock
                  toolName={toolMsg.toolName}
                  input={toolMsg.input}
                  isRunning={toolMsg.isRunning}
                  result={result ? { content: result.content, isError: result.isError, ...(!hideImages && result.images ? { images: result.images } : {}) } : null}
                />
              </div>
            );
          }
          return null;
        })}
      </>
    );
  }

  const isExpanded = expanded || hasRunningTool;

  // Collect all images from tool results for preview outside collapsed group
  const allResultImages: { src: string; toolName: string }[] = [];
  for (const t of toolUses) {
    const result = toolResults.get(t.toolUseId);
    if (result?.images && t.toolName !== "Read") {
      for (const img of result.images) {
        allResultImages.push({ src: img, toolName: t.toolName });
      }
    }
  }

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-1 px-2 w-full text-left border-l-2 border-accent/30 hover:border-accent/60 hover:bg-bg-hover/50 transition-colors rounded-r-sm group"
      >
        {hasRunningTool ? (
          <span className="w-3 h-3 border-[1.5px] border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
        ) : hasError ? (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-error flex-shrink-0">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-success flex-shrink-0">
            <path d="M3 8.5l3.5 3.5L13 4" />
          </svg>
        )}
        <span className="text-[11px] text-text-muted">
          {toolCount} tool uses
        </span>
        <span className="text-[11px] text-text-secondary font-mono truncate">
          {summary}
        </span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
          className={`flex-shrink-0 text-text-muted ml-auto transition-transform ${isExpanded ? "rotate-180" : ""}`}
        >
          <path d="M3 4l2 2 2-2" />
        </svg>
      </button>
      {isExpanded && (
        <div className="ml-3 mt-1 space-y-0.5">
          {toolMessages.map((msg) => {
            if (msg.role === "tool_use") {
              const toolMsg = msg as ToolUseMessage;
              const result = toolResults.get(toolMsg.toolUseId);
              const hideImages = toolMsg.toolName === "Read";
              return (
                <ToolBlock
                  key={msg.id}
                  toolName={toolMsg.toolName}
                  input={toolMsg.input}
                  isRunning={toolMsg.isRunning}
                  result={result ? { content: result.content, isError: result.isError, ...(!hideImages && result.images ? { images: result.images } : {}) } : null}
                />
              );
            }
            return null;
          })}
        </div>
      )}
      {/* Show images outside collapsed group for quick preview */}
      {!isExpanded && allResultImages.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {allResultImages.map((img, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={img.src}
              alt={`${img.toolName} result`}
              className="max-w-full max-h-96 rounded-lg border border-border object-contain cursor-pointer hover:opacity-90 transition-opacity"
              loading="lazy"
              onClick={() => setModalImage(img.src)}
            />
          ))}
        </div>
      )}
      {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
    </div>
  );
}

// =========================================
// Group messages into segments
// =========================================

type MessageSegment =
  | { type: "message"; msg: UIMessage; index: number }
  | { type: "toolgroup"; messages: UIMessage[]; startIndex: number };

function groupMessages(messages: UIMessage[]): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let currentToolGroup: UIMessage[] | null = null;
  let toolGroupStart = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "tool_use" || msg.role === "tool_result") {
      if (!currentToolGroup) {
        currentToolGroup = [];
        toolGroupStart = i;
      }
      currentToolGroup.push(msg);
    } else {
      if (currentToolGroup) {
        segments.push({ type: "toolgroup", messages: currentToolGroup, startIndex: toolGroupStart });
        currentToolGroup = null;
      }
      segments.push({ type: "message", msg, index: i });
    }
  }
  if (currentToolGroup) {
    segments.push({ type: "toolgroup", messages: currentToolGroup, startIndex: toolGroupStart });
  }

  return segments;
}

// =========================================
// ChatArea
// =========================================

export default memo(function ChatArea({
  messages, isLoading, isStreamConnected, loadingStartTime, statusMessage,
  onSendPrompt, onBranchChat,
  onPlanApproval, onAskUserAnswer, onTogglePin,
  onEditMessage, onRegenerate, onRetry,
  chatCost, chatDuration, chatInputTokens, chatOutputTokens, chatTurnCount,
  searchOpen, onSearchClose,
  isLoadingChat,
}: ChatAreaProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const prevMessageCountRef = useRef(messages.length);

  // Auto-scroll: only when user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // If new messages added, show scroll button if user is scrolled up
    if (messages.length > prevMessageCountRef.current && userScrolledUp) {
      setShowScrollButton(true);
    }
    prevMessageCountRef.current = messages.length;
  }, [messages, userScrolledUp]);

  // Detect user scroll
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 100;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setUserScrolledUp(!isAtBottom);
    if (isAtBottom) setShowScrollButton(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUserScrolledUp(false);
    setShowScrollButton(false);
  }, []);

  const toolResults = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "tool_result") {
        map.set(msg.toolUseId, msg);
      }
    }
    return map;
  }, [messages]);

  const segments = useMemo(() => groupMessages(messages), [messages]);

  const pinnedMessages = useMemo(
    () => messages.filter((m) => m.pinned && (m.role === "user" || m.role === "assistant")),
    [messages]
  );

  // Find index of last assistant message (for regenerate button)
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && (messages[i] as AssistantTextMessage).content.trim()) {
        return i;
      }
    }
    return -1;
  }, [messages]);

  // Loading skeleton while switching chats
  if (isLoadingChat) {
    return <ChatSkeleton />;
  }

  // Empty state
  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-lg">
          <h2 className="text-lg font-semibold text-text-primary mb-1">
            Claude Agent Chat
          </h2>
          <p className="text-text-muted text-sm mb-6">
            What would you like to work on?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SUGGESTED_PROMPTS.map((item) => (
              <button
                key={item.label}
                onClick={() => onSendPrompt?.(item.prompt)}
                className="flex items-start gap-2.5 p-3 rounded-xl border border-border bg-bg-secondary hover:bg-bg-hover hover:border-accent/30 transition-colors text-left group"
              >
                <span className="text-base mt-0.5">{item.icon}</span>
                <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto relative" ref={scrollContainerRef} onScroll={handleScroll}>
      {/* In-conversation search bar */}
      <SearchBar
        messages={messages}
        isOpen={!!searchOpen}
        onClose={() => onSearchClose?.()}
        scrollContainerRef={scrollContainerRef}
      />
      {/* Pinned messages strip - sticky below SearchBar */}
      {pinnedMessages.length > 0 && (
        <div className="sticky top-0 z-10 bg-bg-primary/95 backdrop-blur-sm border-b border-accent/10 px-4 py-2">
          <div className="max-w-3xl mx-auto">
            <PinnedStrip
              pinnedMessages={pinnedMessages}
              onTogglePin={onTogglePin}
              scrollContainerRef={scrollContainerRef}
            />
          </div>
        </div>
      )}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {segments.map((segment, i) => {
          if (segment.type === "message") {
            if (segment.msg.role === "plan_approval") {
              const planMsg = segment.msg as PlanApprovalMessage;
              return (
                <div key={segment.msg.id} data-message-id={segment.msg.id}>
                  <PlanApprovalBlock
                    status={planMsg.status}
                    feedback={planMsg.feedback}
                    allowedPrompts={planMsg.allowedPrompts}
                    planContent={planMsg.planContent}
                    onApprove={(feedback) => onPlanApproval?.(true, feedback)}
                    onReject={(feedback) => onPlanApproval?.(false, feedback)}
                  />
                </div>
              );
            }
            if (segment.msg.role === "ask_user") {
              const askMsg = segment.msg as AskUserMessage;
              return (
                <div key={segment.msg.id} data-message-id={segment.msg.id}>
                  <AskUserBlock
                    questions={askMsg.questions}
                    status={askMsg.status}
                    answers={askMsg.answers}
                    onAnswer={(answers) => onAskUserAnswer?.(answers)}
                  />
                </div>
              );
            }

            const isLastAssistant = segment.msg.role === "assistant" && segment.index === lastAssistantIndex;

            return (
              <div key={segment.msg.id} data-message-id={segment.msg.id} className="transition-all duration-300">
                <MessageBubble
                  message={segment.msg}
                  toolResults={toolResults}
                  messageIndex={segment.index}
                  onBranch={onBranchChat}
                  onTogglePin={onTogglePin}
                  onEditMessage={onEditMessage}
                  onRegenerate={onRegenerate}
                  onRetry={onRetry}
                  isLastAssistant={isLastAssistant}
                />
              </div>
            );
          }
          // Tool group
          const hasRunningTool = segment.messages.some(
            (m) => m.role === "tool_use" && (m as ToolUseMessage).isRunning
          );
          return (
            <ToolGroup
              key={`toolgroup-${i}`}
              toolMessages={segment.messages}
              toolResults={toolResults}
              hasRunningTool={hasRunningTool}
            />
          );
        })}

        {/* Activity indicator */}
        {isLoading && messages.length > 0 && (() => {
          const last = messages[messages.length - 1];
          const isStreaming = last.role === "assistant" && (last as { isStreaming?: boolean }).isStreaming;
          const isToolRunning = last.role === "tool_use" && (last as { isRunning?: boolean }).isRunning;
          if (isStreaming || isToolRunning) return null;

          return (
            <ThinkingIndicator
              isStreamConnected={!!isStreamConnected}
              loadingStartTime={loadingStartTime || Date.now()}
              statusMessage={statusMessage}
            />
          );
        })()}

        {/* Usage display */}
        {((chatInputTokens && chatInputTokens > 0) || (chatOutputTokens && chatOutputTokens > 0) || (chatCost !== undefined && chatCost > 0)) && (
          <div className="flex justify-center py-2">
            <div className="text-[10px] text-text-muted bg-bg-secondary rounded-full px-3 py-1 flex items-center gap-2">
              {(chatInputTokens || 0) + (chatOutputTokens || 0) > 0 ? (
                <span>{((chatInputTokens || 0) + (chatOutputTokens || 0) >= 1000) ? `${(((chatInputTokens || 0) + (chatOutputTokens || 0)) / 1000).toFixed(1)}k` : (chatInputTokens || 0) + (chatOutputTokens || 0)} tokens</span>
              ) : chatCost !== undefined && chatCost > 0 ? (
                <span>${chatCost.toFixed(4)}</span>
              ) : null}
              {chatTurnCount !== undefined && chatTurnCount > 0 && (
                <>
                  <span>&middot;</span>
                  <span>{chatTurnCount} turns</span>
                </>
              )}
              {chatDuration !== undefined && chatDuration > 0 && (
                <>
                  <span>&middot;</span>
                  <span>{(chatDuration / 1000).toFixed(1)}s</span>
                </>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>{/* end max-w-3xl */}

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-4 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary border border-border rounded-full shadow-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors w-fit mx-auto"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 2v8M3 7l3 3 3-3" />
          </svg>
          New messages
        </button>
      )}
    </div>
  );
});
