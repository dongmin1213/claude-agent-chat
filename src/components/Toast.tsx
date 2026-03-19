"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";

// =========================================
// Types
// =========================================

export type ToastType = "error" | "warning" | "info" | "success";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string, duration?: number) => void;
  /** Add a toast with an action button (e.g. Undo) */
  addToastWithAction: (
    type: ToastType,
    message: string,
    action: { label: string; onClick: () => void },
    duration?: number
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// =========================================
// Hook
// =========================================

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

// =========================================
// Toast Item
// =========================================

const ICONS: Record<ToastType, ReactNode> = {
  error: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M6 6l4 4M10 6l-4 4" />
    </svg>
  ),
  warning: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3v6M8 11.5v.5" />
      <path d="M7.13 2.5L1.5 12.5a1 1 0 00.87 1.5h11.26a1 1 0 00.87-1.5L9.87 2.5a1 1 0 00-1.74 0z" />
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4M8 5v.5" />
    </svg>
  ),
  success: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M5.5 8l2 2 3-3.5" />
    </svg>
  ),
};

const COLORS: Record<ToastType, string> = {
  error: "border-red-500/40 bg-red-500/10 text-red-400",
  warning: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
  info: "border-accent/40 bg-accent/10 text-accent",
  success: "border-green-500/40 bg-green-500/10 text-green-400",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(toast.id), 300);
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  };

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border backdrop-blur-sm shadow-lg text-xs max-w-[360px] transition-all duration-300 ${COLORS[toast.type]} ${
        exiting ? "toast-exit" : "toast-enter"
      }`}
      role="alert"
      aria-live={toast.type === "error" ? "assertive" : "polite"}
    >
      <span className="flex-shrink-0 mt-0.5">{ICONS[toast.type]}</span>
      <span className="flex-1 leading-relaxed">{toast.message}</span>
      {/* Action button (e.g. Undo) */}
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            handleDismiss();
          }}
          className="flex-shrink-0 font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity mt-0.5"
        aria-label="Dismiss notification"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>
    </div>
  );
}

// =========================================
// Provider
// =========================================

const MAX_TOASTS = 5;
const DEFAULT_DURATIONS: Record<ToastType, number> = {
  error: 12000,   // 12s for errors (increased from 8s — critical)
  warning: 8000,  // 8s for warnings
  info: 5000,
  success: 4000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = crypto.randomUUID();
    const dur = duration ?? DEFAULT_DURATIONS[type];
    setToasts((prev) => {
      const next = [...prev, { id, type, message, duration: dur }];
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
    });
  }, []);

  const addToastWithAction = useCallback(
    (type: ToastType, message: string, action: { label: string; onClick: () => void }, duration?: number) => {
      const id = crypto.randomUUID();
      const dur = duration ?? DEFAULT_DURATIONS[type];
      setToasts((prev) => {
        const next = [...prev, { id, type, message, duration: dur, action }];
        return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
      });
    },
    []
  );

  return (
    <ToastContext.Provider value={{ addToast, addToastWithAction }}>
      {children}
      {/* Toast container - bottom right */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-label="Notifications">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
