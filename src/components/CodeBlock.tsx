"use client";

import { useState, useEffect, useMemo } from "react";

interface CodeBlockProps {
  language: string;
  children: string;
}

const PREVIEWABLE_LANGUAGES = new Set(["html", "htm", "svg"]);

export default function CodeBlock({ language, children }: CodeBlockProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<"github-dark" | "github-light">("github-dark");
  const [showPreview, setShowPreview] = useState(false);

  const isPreviewable = PREVIEWABLE_LANGUAGES.has(language?.toLowerCase() || "");

  // Build HTML content for preview
  const previewHtml = useMemo(() => {
    if (!isPreviewable) return "";
    const lang = language?.toLowerCase() || "";
    if (lang === "html" || lang === "htm") return children;
    if (lang === "svg") return `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${children}</body></html>`;
    return children;
  }, [children, language, isPreviewable]);

  // Detect theme changes
  useEffect(() => {
    const detect = () => {
      const t = document.documentElement.getAttribute("data-theme");
      setTheme(t === "light" ? "github-light" : "github-dark");
    };
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { highlightCode } = await import("@/lib/shiki");
        const html = await highlightCode(children, language || "text", theme);
        if (!cancelled) setHighlighted(html);
      } catch {
        if (!cancelled) setHighlighted(null);
      }
    })();
    return () => { cancelled = true; };
  }, [children, language, theme]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrapper group/code relative my-3 rounded-lg border border-border overflow-hidden bg-bg-primary min-w-0">
      {/* Header: language badge + preview/copy buttons */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-secondary/80 border-b border-border">
        <span className="text-[11px] text-text-muted font-mono">
          {language || "text"}
        </span>
        <div className="flex items-center gap-2">
          {isPreviewable && (
            <button
              onClick={() => setShowPreview((p) => !p)}
              className={`flex items-center gap-1 text-[11px] transition-colors ${
                showPreview ? "text-accent" : "text-text-muted hover:text-text-primary"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="12" height="10" rx="1" />
                <path d="M5 8l2 2 4-4" />
              </svg>
              {showPreview ? "Code" : "Preview"}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors"
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
        </div>
      </div>

      {/* Preview iframe */}
      {showPreview && isPreviewable ? (
        <ArtifactPreview html={previewHtml} />
      ) : (
        <>
          {/* Code content */}
          {highlighted ? (
            <div
              className="overflow-x-auto text-[13px] leading-relaxed break-normal [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-3 [&_pre]:!border-0 [&_pre]:!rounded-none [&_pre]:!whitespace-pre [&_code]:!text-[13px] [&_code]:!break-normal"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          ) : (
            <pre className="p-3 overflow-x-auto text-[13px] leading-relaxed text-text-secondary !bg-transparent !border-0 !rounded-none !m-0 !whitespace-pre !break-normal">
              <code className="!break-normal">{children}</code>
            </pre>
          )}
        </>
      )}
    </div>
  );
}

// Sandboxed iframe preview for HTML/SVG artifacts
function ArtifactPreview({ html }: { html: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [html]);

  if (!blobUrl) return null;

  return (
    <iframe
      src={blobUrl}
      sandbox="allow-scripts"
      className="w-full border-0 bg-white"
      style={{ height: "300px" }}
      title="Artifact Preview"
    />
  );
}
