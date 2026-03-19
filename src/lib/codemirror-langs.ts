import type { Extension } from "@codemirror/state";

type LangLoader = () => Promise<Extension>;

const langMap: Record<string, LangLoader> = {
  ts: () => import("@codemirror/lang-javascript").then(m => m.javascript({ typescript: true, jsx: false })),
  tsx: () => import("@codemirror/lang-javascript").then(m => m.javascript({ typescript: true, jsx: true })),
  js: () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: false })),
  jsx: () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true })),
  mjs: () => import("@codemirror/lang-javascript").then(m => m.javascript()),
  cjs: () => import("@codemirror/lang-javascript").then(m => m.javascript()),
  py: () => import("@codemirror/lang-python").then(m => m.python()),
  json: () => import("@codemirror/lang-json").then(m => m.json()),
  css: () => import("@codemirror/lang-css").then(m => m.css()),
  scss: () => import("@codemirror/lang-css").then(m => m.css()),
  less: () => import("@codemirror/lang-css").then(m => m.css()),
  html: () => import("@codemirror/lang-html").then(m => m.html()),
  htm: () => import("@codemirror/lang-html").then(m => m.html()),
  vue: () => import("@codemirror/lang-html").then(m => m.html()),
  svelte: () => import("@codemirror/lang-html").then(m => m.html()),
  md: () => import("@codemirror/lang-markdown").then(m => m.markdown()),
  mdx: () => import("@codemirror/lang-markdown").then(m => m.markdown()),
  rs: () => import("@codemirror/lang-rust").then(m => m.rust()),
  cpp: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  c: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  h: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  hpp: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  cs: () => import("@codemirror/lang-java").then(m => m.java()), // closest match
  java: () => import("@codemirror/lang-java").then(m => m.java()),
  kt: () => import("@codemirror/lang-java").then(m => m.java()), // closest match
  xml: () => import("@codemirror/lang-xml").then(m => m.xml()),
  svg: () => import("@codemirror/lang-xml").then(m => m.xml()),
  csproj: () => import("@codemirror/lang-xml").then(m => m.xml()),
  config: () => import("@codemirror/lang-xml").then(m => m.xml()),
  sql: () => import("@codemirror/lang-sql").then(m => m.sql()),
  yaml: () => import("@codemirror/lang-json").then(m => m.json()), // basic fallback
  yml: () => import("@codemirror/lang-json").then(m => m.json()),
  toml: () => import("@codemirror/lang-json").then(m => m.json()),
};

const cache = new Map<string, Extension>();

export async function getLanguageExtension(filename: string): Promise<Extension | null> {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const cached = cache.get(ext);
  if (cached) return cached;

  const loader = langMap[ext];
  if (!loader) return null;

  try {
    const extension = await loader();
    cache.set(ext, extension);
    return extension;
  } catch {
    return null;
  }
}
