"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-screen bg-bg-primary p-8">
          <div className="max-w-md w-full bg-bg-secondary border border-border rounded-xl p-6 text-center space-y-4">
            {/* Error icon */}
            <div className="w-12 h-12 mx-auto rounded-full bg-error/10 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-error">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-text-primary mb-1">
                Something went wrong
              </h2>
              <p className="text-xs text-text-muted">
                The application encountered an unexpected error. This is usually temporary.
              </p>
            </div>

            {/* Error details (collapsible) */}
            {this.state.error && (
              <details className="text-left">
                <summary className="text-[10px] text-text-muted cursor-pointer hover:text-text-secondary">
                  Error details
                </summary>
                <pre className="mt-2 p-2 bg-bg-primary border border-border rounded text-[10px] text-error/80 overflow-auto max-h-32 whitespace-pre-wrap break-all">
                  {this.state.error.message}
                  {this.state.error.stack && `\n\n${this.state.error.stack}`}
                </pre>
              </details>
            )}

            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 text-xs bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
