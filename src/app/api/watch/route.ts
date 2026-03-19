import { NextRequest } from "next/server";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("dir");
  if (!dir) {
    return Response.json({ error: "dir is required" }, { status: 400 });
  }

  const { watch } = await import("chokidar");
  const encoder = new TextEncoder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let watcher: any = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`)
      );

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const pendingDirs = new Set<string>();
      const pendingFiles = new Set<string>();

      watcher = watch(dir, {
        ignored: [
          "**/node_modules/**",
          "**/.next/**",
          "**/.git/**",
          "**/.vs/**",
          "**/bin/**",
          "**/obj/**",
          "**/build/**",
          "**/dist/**",
          "**/packages/**",
        ],
        persistent: true,
        ignoreInitial: true,
        depth: 3,
        usePolling: false,
      });

      const flush = () => {
        if (pendingDirs.size > 0 || pendingFiles.size > 0) {
          const dirs = [...pendingDirs];
          const files = [...pendingFiles];
          pendingDirs.clear();
          pendingFiles.clear();
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "change", dirs, files })}\n\n`
              )
            );
          } catch {
            // Stream closed
          }
        }
      };

      watcher.on("all", (_event: string, filePath: string) => {
        pendingDirs.add(path.dirname(filePath));
        pendingFiles.add(filePath);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flush, 300);
      });

      watcher.on("error", () => {});

      request.signal.addEventListener("abort", () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        watcher?.close();
        watcher = null;
      });
    },
    cancel() {
      watcher?.close();
      watcher = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
