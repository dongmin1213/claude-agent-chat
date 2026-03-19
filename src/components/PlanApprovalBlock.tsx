"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PlanApprovalBlockProps {
  status: "pending" | "approved" | "rejected";
  feedback?: string;
  allowedPrompts?: { tool: string; prompt: string }[];
  planContent?: string;
  onApprove?: (feedback?: string) => void;
  onReject?: (feedback: string) => void;
}

export default function PlanApprovalBlock({
  status,
  feedback,
  allowedPrompts,
  planContent,
  onApprove,
  onReject,
}: PlanApprovalBlockProps) {
  const [mode, setMode] = useState<"default" | "approve_feedback" | "reject_feedback">("default");
  const [feedbackText, setFeedbackText] = useState("");
  const [showPlan, setShowPlan] = useState(false);

  // ── Approved state ──
  if (status === "approved") {
    return (
      <div className="my-3 px-4 py-3 rounded-lg bg-success/10 border border-success/20 space-y-1">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-success flex-shrink-0">
            <path d="M3 8.5l3.5 3.5L13 4" />
          </svg>
          <span className="text-sm text-success font-medium">Plan approved</span>
        </div>
        {feedback && (
          <p className="text-xs text-text-secondary ml-6">{feedback}</p>
        )}
      </div>
    );
  }

  // ── Rejected state ──
  if (status === "rejected") {
    return (
      <div className="my-3 px-4 py-3 rounded-lg bg-error/10 border border-error/20 space-y-1">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-error flex-shrink-0">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
          <span className="text-sm text-error font-medium">Plan rejected</span>
        </div>
        {feedback && (
          <p className="text-xs text-text-secondary ml-6">{feedback}</p>
        )}
      </div>
    );
  }

  // ── Pending state ──
  return (
    <div className="my-3 rounded-lg border border-accent/30 bg-accent/5 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-accent flex-shrink-0">
          <rect x="2" y="2" width="12" height="12" rx="2" />
          <path d="M5 6h6M5 8.5h6M5 11h3" />
        </svg>
        <span className="text-sm font-medium text-text-primary">
          Plan ready for review
        </span>

        {/* View plan toggle — always show button */}
        <button
          onClick={() => setShowPlan(!showPlan)}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[11px] text-accent hover:text-accent-hover transition-colors rounded"
        >
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`transition-transform ${showPlan ? "rotate-180" : ""}`}
          >
            <path d="M3 4l2 2 2-2" />
          </svg>
          {showPlan ? "Hide plan" : "View plan"}
        </button>
      </div>

      {/* Plan content (collapsible) */}
      {showPlan && (
        <div className="px-4 pb-3">
          {planContent ? (
            <div className="rounded-md bg-bg-primary/50 border border-border/30 p-3 max-h-80 overflow-y-auto text-xs text-text-secondary leading-relaxed
              [&_h1]:text-xs [&_h1]:font-semibold [&_h1]:text-text-primary [&_h1]:mt-3 [&_h1]:mb-1
              [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-text-primary [&_h2]:mt-2.5 [&_h2]:mb-1
              [&_h3]:text-xs [&_h3]:font-medium [&_h3]:text-text-primary [&_h3]:mt-2 [&_h3]:mb-0.5
              [&_p]:my-1
              [&_ul]:my-1 [&_ul]:pl-4 [&_ul]:list-disc
              [&_ol]:my-1 [&_ol]:pl-4 [&_ol]:list-decimal
              [&_li]:my-0.5
              [&_code]:text-accent [&_code]:text-[11px] [&_code]:bg-bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono
              [&_strong]:text-text-primary [&_strong]:font-medium
              [&_a]:text-accent [&_a]:underline
              [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-muted [&_blockquote]:italic">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{planContent}</ReactMarkdown>
            </div>
          ) : (
            <div className="rounded-md bg-bg-primary/50 border border-border/30 p-3 text-xs text-text-muted italic">
              Plan content could not be captured. Check the chat messages above for plan details.
            </div>
          )}
        </div>
      )}

      {/* Allowed Prompts (permissions needed) */}
      {allowedPrompts && allowedPrompts.length > 0 && (
        <div className="px-4 pb-2">
          <div className="text-[11px] text-text-muted mb-1.5 font-medium uppercase tracking-wider">
            Permissions needed
          </div>
          <div className="space-y-1">
            {allowedPrompts.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded text-[10px] font-mono flex-shrink-0">
                  {p.tool}
                </span>
                <span className="text-text-secondary">{p.prompt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback textarea (shown for approve_feedback or reject_feedback) */}
      {mode !== "default" && (
        <div className="px-4 pb-2">
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={mode === "approve_feedback" ? "Any additional comments or suggestions..." : "What should be changed?"}
            className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-md resize-none focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted"
            rows={2}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && feedbackText.trim()) {
                if (mode === "approve_feedback") {
                  onApprove?.(feedbackText.trim());
                } else {
                  onReject?.(feedbackText.trim());
                }
              }
              if (e.key === "Escape") {
                setMode("default");
                setFeedbackText("");
              }
            }}
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="px-4 pb-3 flex items-center gap-2">
        {mode === "default" ? (
          <>
            <button
              onClick={() => onApprove?.()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-success/15 text-success hover:bg-success/25 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 8.5l3.5 3.5L13 4" />
              </svg>
              Approve
            </button>
            <button
              onClick={() => setMode("approve_feedback")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-success/5 text-success/70 hover:bg-success/15 hover:text-success transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="flex-shrink-0">
                <path d="M12 3l1 1-7 7-3 1 1-3 7-7z" />
                <path d="M10.5 4.5l1 1" />
              </svg>
              Approve with comments
            </button>
            <button
              onClick={() => setMode("reject_feedback")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-error/10 text-error/80 hover:bg-error/20 hover:text-error transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
              Reject
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                if (mode === "approve_feedback") {
                  onApprove?.(feedbackText.trim() || undefined);
                } else if (feedbackText.trim()) {
                  onReject?.(feedbackText.trim());
                }
              }}
              disabled={mode === "reject_feedback" && !feedbackText.trim()}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === "approve_feedback"
                  ? "bg-success/15 text-success hover:bg-success/25"
                  : "bg-error/15 text-error hover:bg-error/25"
              }`}
            >
              {mode === "approve_feedback" ? "Approve with feedback" : "Send feedback"}
            </button>
            <button
              onClick={() => {
                setMode("default");
                setFeedbackText("");
              }}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
