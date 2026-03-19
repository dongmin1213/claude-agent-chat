"use client";

import { useState, useRef, useEffect } from "react";
import type { UIMessage, ToolResultMessage } from "@/types/chat";
import ToolBlock from "./ToolBlock";
import CodeBlock from "./CodeBlock";
import ImageModal from "./ImageModal";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageBubbleProps {
  message: UIMessage;
  toolResults: Map<string, ToolResultMessage>;
  messageIndex?: number;
  onBranch?: (messageIndex: number) => void;
  onTogglePin?: (messageId: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: () => void;
  onRetry?: () => void;
  isLastAssistant?: boolean;
}

// =========================================
// Relative time helper
// =========================================

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// =========================================
// Action Buttons
// =========================================

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors py-1"
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 8.5l3.5 3.5L13 4" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5" y="5" width="8" height="8" rx="1" />
            <path d="M3 11V3a1 1 0 011-1h8" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors py-1"
      title="Edit message"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M11.5 1.5l3 3-9 9H2.5v-3z" />
        <path d="M10 3l3 3" />
      </svg>
      Edit
    </button>
  );
}

function RegenerateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors py-1"
      title="Regenerate response"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 8a6 6 0 0111.3-2.8" />
        <path d="M14 8a6 6 0 01-11.3 2.8" />
        <path d="M13 2v3.5h-3.5" />
        <path d="M3 14v-3.5h3.5" />
      </svg>
      Regenerate
    </button>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] text-error/70 hover:text-error transition-colors py-1"
      title="Retry"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 8a6 6 0 0111.3-2.8" />
        <path d="M14 8a6 6 0 01-11.3 2.8" />
        <path d="M13 2v3.5h-3.5" />
        <path d="M3 14v-3.5h3.5" />
      </svg>
      Retry
    </button>
  );
}

function BranchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors py-1"
      title="Branch from here"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="4" cy="4" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="4" r="2" />
        <path d="M4 6v2c0 2 2 4 4 4h2" />
        <path d="M4 4h6" />
      </svg>
      Branch
    </button>
  );
}

function PinButton({ pinned, onClick }: { pinned: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 text-[11px] transition-colors py-1 ${
        pinned ? "text-accent" : "text-text-muted hover:text-text-primary"
      }`}
      title={pinned ? "Unpin message" : "Pin message"}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
        <path d="M9.5 2L14 6.5l-3 1-2.5 3L7 12l-1-2-3.5-1 3-2.5 1-3z" />
        <path d="M5 11L2 14" />
      </svg>
      {pinned ? "Pinned" : "Pin"}
    </button>
  );
}

// =========================================
// Main Component
// =========================================

export default function MessageBubble({
  message,
  toolResults,
  messageIndex,
  onBranch,
  onTogglePin,
  onEditMessage,
  onRegenerate,
  onRetry,
  isLastAssistant,
}: MessageBubbleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [modalImage, setModalImage] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus and auto-resize edit textarea
  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      editRef.current.style.height = "auto";
      editRef.current.style.height = editRef.current.scrollHeight + "px";
    }
  }, [isEditing]);

  // ---- Plan approval & Ask user (handled by ChatArea directly) ----
  if (message.role === "plan_approval" || message.role === "ask_user") {
    return null;
  }

  // ---- User message ----
  if (message.role === "user") {
    const userImages = (message as { images?: string[] }).images;

    if (isEditing) {
      return (
        <div className="flex justify-end mb-4">
          <div className="max-w-[80%] min-w-[300px]">
            <div className="bg-accent-dim/30 border border-accent/40 rounded-2xl rounded-br-md px-4 py-2.5">
              <textarea
                ref={editRef}
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsEditing(false);
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (editContent.trim() && onEditMessage) {
                      onEditMessage(message.id, editContent.trim());
                      setIsEditing(false);
                    }
                  }
                }}
                className="w-full bg-transparent text-text-primary text-sm leading-relaxed resize-none outline-none"
                rows={1}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1 text-xs text-text-muted hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (editContent.trim() && onEditMessage) {
                      onEditMessage(message.id, editContent.trim());
                      setIsEditing(false);
                    }
                  }}
                  className="px-3 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
      {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
      <div className="flex justify-end mb-4 group/msg">
        <div className="max-w-[80%] min-w-0 overflow-hidden">
          <div className="bg-accent-dim/30 border border-accent/20 rounded-2xl rounded-br-md px-4 py-2.5 overflow-hidden">
            {/* User-attached images */}
            {userImages && userImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {userImages.map((src, i) => {
                  const imgSrc = src.startsWith("data:") ? src : `/api/image?path=${encodeURIComponent(src)}`;
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={imgSrc}
                      alt={`attached image ${i + 1}`}
                      className="max-w-[200px] max-h-[200px] rounded-lg border border-accent/20 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                      loading="lazy"
                      onClick={() => setModalImage(imgSrc)}
                    />
                  );
                })}
              </div>
            )}
            <p className="text-text-primary whitespace-pre-wrap text-sm leading-relaxed break-words [overflow-wrap:anywhere]">
              {message.content}
            </p>
          </div>
          {/* Action buttons - visible on hover */}
          <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity mt-1 flex justify-end items-center gap-3">
            <span className="text-[10px] text-text-muted/50 mr-auto">{relativeTime(message.timestamp)}</span>
            {onEditMessage && (
              <EditButton onClick={() => { setEditContent(message.content); setIsEditing(true); }} />
            )}
            {onTogglePin && (
              <PinButton pinned={!!message.pinned} onClick={() => onTogglePin(message.id)} />
            )}
            {onBranch && messageIndex !== undefined && (
              <BranchButton onClick={() => onBranch(messageIndex)} />
            )}
          </div>
        </div>
      </div>
      </>
    );
  }

  // ---- Assistant text ----
  if (message.role === "assistant") {
    if (!message.content.trim() && !message.isStreaming) return null;
    return (
      <>
      {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
      <div className="flex justify-start mb-4 group/msg">
        <div className="max-w-[85%] min-w-0 overflow-hidden">
          <div className="markdown-content text-sm leading-relaxed break-words [overflow-wrap:break-word] [&_.code-block-wrapper]:overflow-x-auto [&_.code-block-wrapper]:break-normal [&_.code-block-wrapper]:max-w-full">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children }) {
                  const match = /language-(\w+)/.exec(className || "");
                  const codeString = String(children).replace(/\n$/, "");
                  const isBlock = !!match || !!className || codeString.includes("\n");
                  if (!isBlock) {
                    return (
                      <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[13px] text-accent/90">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <CodeBlock language={match ? match[1] : ""}>
                      {codeString}
                    </CodeBlock>
                  );
                },
                pre({ children }) {
                  return <>{children}</>;
                },
                img({ src, alt }) {
                  return (
                    <span className="block my-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={alt || "image"}
                        className="max-w-full rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
                        loading="lazy"
                        onClick={() => src && typeof src === "string" && setModalImage(src)}
                      />
                    </span>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
            {message.isStreaming && (
              <span className="inline-block w-2 h-[18px] bg-accent/80 rounded-sm animate-blink ml-0.5 align-middle" />
            )}
          </div>
          {/* Action buttons */}
          {!message.isStreaming && message.content && (
            <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity mt-1 flex items-center gap-3">
              <span className="text-[10px] text-text-muted/50 mr-auto">{relativeTime(message.timestamp)}</span>
              <CopyButton text={message.content} />
              {isLastAssistant && onRegenerate && (
                <RegenerateButton onClick={onRegenerate} />
              )}
              {onTogglePin && (
                <PinButton pinned={!!message.pinned} onClick={() => onTogglePin(message.id)} />
              )}
              {onBranch && messageIndex !== undefined && (
                <BranchButton onClick={() => onBranch(messageIndex)} />
              )}
            </div>
          )}
        </div>
      </div>
      </>
    );
  }

  // ---- Tool use ----
  if (message.role === "tool_use") {
    const result = toolResults.get(message.toolUseId);
    return (
      <div className="mb-2 max-w-[85%]">
        <ToolBlock
          toolName={message.toolName}
          input={message.input}
          isRunning={message.isRunning}
          result={result ? { content: result.content, isError: result.isError } : null}
        />
      </div>
    );
  }

  // ---- Tool result (standalone) ----
  if (message.role === "tool_result") {
    return null;
  }

  // ---- Error ----
  if (message.role === "error") {
    return (
      <div className="flex justify-start mb-4">
        <div className="max-w-[85%]">
          <div className="bg-error/10 border border-error/30 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-error text-sm">&#x26A0;</span>
              <span className="text-error text-xs font-semibold">Error</span>
            </div>
            <p className="text-error/80 text-sm whitespace-pre-wrap">
              {message.content}
            </p>
          </div>
          {onRetry && (
            <div className="mt-1 flex items-center gap-3">
              <RetryButton onClick={onRetry} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
