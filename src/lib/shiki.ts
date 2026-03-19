// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highlighterPromise: Promise<any> | null = null;

export function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((mod) =>
      mod.createHighlighter({
        themes: ["github-dark", "github-light"],
        langs: [
          "javascript", "typescript", "jsx", "tsx", "json", "html", "css",
          "python", "rust", "go", "java", "c", "cpp", "csharp", "ruby",
          "php", "swift", "kotlin", "dart", "sql", "yaml", "toml",
          "markdown", "bash", "powershell", "dockerfile", "xml",
        ],
      })
    );
  }
  return highlighterPromise;
}

export function getCurrentTheme(): "github-dark" | "github-light" {
  if (typeof document !== "undefined") {
    return document.documentElement.getAttribute("data-theme") === "light"
      ? "github-light"
      : "github-dark";
  }
  return "github-dark";
}

export async function highlightCode(
  code: string,
  lang: string,
  theme?: "github-dark" | "github-light"
): Promise<string> {
  const resolvedTheme = theme || getCurrentTheme();
  try {
    const highlighter = await getHighlighter();
    const loadedLangs = highlighter.getLoadedLanguages() as string[];
    const targetLang = lang || "text";
    if (targetLang !== "text" && !loadedLangs.includes(targetLang)) {
      try {
        await highlighter.loadLanguage(targetLang);
      } catch {
        return highlighter.codeToHtml(code, { lang: "text", theme: resolvedTheme });
      }
    }
    return highlighter.codeToHtml(code, { lang: targetLang, theme: resolvedTheme });
  } catch {
    const isDark = resolvedTheme === "github-dark";
    const bg = isDark ? "#0d1117" : "#ffffff";
    const fg = isDark ? "#e6edf3" : "#1f2328";
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre style="background:${bg};color:${fg};padding:1em;overflow-x:auto"><code>${escaped}</code></pre>`;
  }
}
