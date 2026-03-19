"use client";

import { useState } from "react";
import type { AskUserQuestion } from "@/types/chat";

interface AskUserBlockProps {
  questions: AskUserQuestion[];
  status: "pending" | "answered";
  answers?: Record<string, string>;
  onAnswer?: (answers: Record<string, string>) => void;
}

export default function AskUserBlock({
  questions,
  status,
  answers,
  onAnswer,
}: AskUserBlockProps) {
  // Track selections per question: question text → selected label(s)
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  // Track "Other" mode per question
  const [useOther, setUseOther] = useState<Record<string, boolean>>({});
  // Track "Other" text per question
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});

  // ── Answered state ──
  if (status === "answered" && answers) {
    return (
      <div className="my-3 px-4 py-3 rounded-lg bg-success/10 border border-success/20 space-y-2">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-success flex-shrink-0">
            <path d="M3 8.5l3.5 3.5L13 4" />
          </svg>
          <span className="text-sm text-success font-medium">Questions answered</span>
        </div>
        {Object.entries(answers).map(([question, answer]) => (
          <div key={question} className="ml-6 space-y-0.5">
            <div className="text-[11px] text-text-muted">{question}</div>
            <div className="text-xs text-text-primary font-medium">{answer}</div>
          </div>
        ))}
      </div>
    );
  }

  // ── Helpers ──

  const toggleOption = (questionText: string, label: string, multiSelect: boolean) => {
    // If "Other" was selected, deselect it
    if (useOther[questionText]) {
      setUseOther((prev) => ({ ...prev, [questionText]: false }));
      setOtherTexts((prev) => ({ ...prev, [questionText]: "" }));
    }

    setSelections((prev) => {
      const current = prev[questionText] || [];
      if (multiSelect) {
        // Toggle in/out
        if (current.includes(label)) {
          return { ...prev, [questionText]: current.filter((l) => l !== label) };
        }
        return { ...prev, [questionText]: [...current, label] };
      } else {
        // Single select: replace
        return { ...prev, [questionText]: [label] };
      }
    });
  };

  const toggleOther = (questionText: string) => {
    const newVal = !useOther[questionText];
    setUseOther((prev) => ({ ...prev, [questionText]: newVal }));
    if (newVal) {
      // Clear regular selections when choosing Other
      setSelections((prev) => ({ ...prev, [questionText]: [] }));
    } else {
      setOtherTexts((prev) => ({ ...prev, [questionText]: "" }));
    }
  };

  const isQuestionAnswered = (q: AskUserQuestion): boolean => {
    if (useOther[q.question]) {
      return (otherTexts[q.question] || "").trim().length > 0;
    }
    return (selections[q.question] || []).length > 0;
  };

  const allAnswered = questions.every(isQuestionAnswered);

  const handleSubmit = () => {
    const result: Record<string, string> = {};
    for (const q of questions) {
      if (useOther[q.question] && otherTexts[q.question]?.trim()) {
        result[q.question] = otherTexts[q.question].trim();
      } else {
        const selected = selections[q.question] || [];
        result[q.question] = selected.join(", ");
      }
    }
    onAnswer?.(result);
  };

  // ── Pending state ──
  return (
    <div className="my-3 rounded-lg border border-accent/30 bg-accent/5 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-accent flex-shrink-0">
          <circle cx="8" cy="8" r="6" />
          <path d="M6 6.5a2 2 0 0 1 3.5 1.5c0 1-1.5 1-1.5 2" />
          <circle cx="8" cy="12" r="0.5" fill="currentColor" />
        </svg>
        <span className="text-sm font-medium text-text-primary">
          Question{questions.length > 1 ? "s" : ""} from assistant
        </span>
      </div>

      {/* Questions */}
      <div className="px-4 pb-2 space-y-4">
        {questions.map((q, qi) => {
          const selected = selections[q.question] || [];
          const isOther = useOther[q.question] || false;

          return (
            <div key={qi} className="space-y-2">
              {/* Header chip + question */}
              <div className="flex items-start gap-2">
                <span className="px-2 py-0.5 bg-accent/15 text-accent rounded text-[10px] font-medium uppercase tracking-wider flex-shrink-0 mt-0.5">
                  {q.header}
                </span>
                <span className="text-sm text-text-primary">{q.question}</span>
              </div>

              {/* Options */}
              <div className="space-y-1.5 ml-0.5">
                {q.options.map((opt, oi) => {
                  const isSelected = selected.includes(opt.label) && !isOther;
                  return (
                    <button
                      key={oi}
                      onClick={() => toggleOption(q.question, opt.label, q.multiSelect)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                        isSelected
                          ? "border-accent/50 bg-accent/10 shadow-sm shadow-accent/5"
                          : "border-border hover:border-accent/30 hover:bg-bg-hover"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {/* Radio / Checkbox indicator */}
                        <div className={`w-4 h-4 mt-0.5 flex-shrink-0 flex items-center justify-center border-2 transition-colors ${
                          q.multiSelect ? "rounded" : "rounded-full"
                        } ${
                          isSelected
                            ? "border-accent bg-accent"
                            : "border-text-muted/50"
                        }`}>
                          {isSelected && (
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                              <path d="M3 8.5l3.5 3.5L13 4" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-text-primary">{opt.label}</div>
                          <div className="text-xs text-text-secondary mt-0.5">{opt.description}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* "Other" option */}
                <button
                  onClick={() => toggleOther(q.question)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                    isOther
                      ? "border-accent/50 bg-accent/10 shadow-sm shadow-accent/5"
                      : "border-border hover:border-accent/30 hover:bg-bg-hover"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`w-4 h-4 mt-0.5 flex-shrink-0 flex items-center justify-center border-2 transition-colors ${
                      q.multiSelect ? "rounded" : "rounded-full"
                    } ${
                      isOther ? "border-accent bg-accent" : "border-text-muted/50"
                    }`}>
                      {isOther && (
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                          <path d="M3 8.5l3.5 3.5L13 4" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary">Other</div>
                      <div className="text-xs text-text-secondary mt-0.5">Provide a custom answer</div>
                    </div>
                  </div>
                </button>

                {/* Other text input */}
                {isOther && (
                  <textarea
                    value={otherTexts[q.question] || ""}
                    onChange={(e) => setOtherTexts((prev) => ({ ...prev, [q.question]: e.target.value }))}
                    placeholder="Type your answer..."
                    className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-md resize-none focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted"
                    rows={2}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && allAnswered) {
                        handleSubmit();
                      }
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit button */}
      <div className="px-4 pb-3 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M14 2L2 8.5l4.5 2L10 5l-2.5 7L14 2z" />
          </svg>
          Submit {questions.length > 1 ? "answers" : "answer"}
        </button>
      </div>
    </div>
  );
}
