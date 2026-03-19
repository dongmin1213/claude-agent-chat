import { NextRequest } from "next/server";
import os from "os";
import path from "path";
import { existsSync } from "fs";
import {
  createTerminal,
  writeTerminal,
  resizeTerminal,
  killTerminal,
  listTerminals,
  onTerminalOutput,
  onTerminalExit,
} from "@/lib/terminal-manager";

export const runtime = "nodejs";

// POST: create, write, resize, kill, list
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, id, cwd, data, cols, rows } = body as {
    action: "create" | "write" | "resize" | "kill" | "list";
    id?: string;
    cwd?: string;
    data?: string;
    cols?: number;
    rows?: number;
  };

  switch (action) {
    case "create": {
      if (!id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const desktopPath = path.join(os.homedir(), "Desktop");
        const defaultCwd = existsSync(desktopPath) ? desktopPath : os.homedir();
        const instance = await createTerminal(id, cwd || defaultCwd, cols || 80, rows || 24);
        return Response.json({ ok: true, id: instance.id, cwd: instance.cwd });
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
      }
    }
    case "write": {
      if (!id || data === undefined) return Response.json({ error: "id and data required" }, { status: 400 });
      const ok = writeTerminal(id, data);
      return Response.json({ ok });
    }
    case "resize": {
      if (!id || !cols || !rows) return Response.json({ error: "id, cols, rows required" }, { status: 400 });
      const ok = resizeTerminal(id, cols, rows);
      return Response.json({ ok });
    }
    case "kill": {
      if (!id) return Response.json({ error: "id required" }, { status: 400 });
      const ok = await killTerminal(id);
      return Response.json({ ok });
    }
    case "list": {
      const terminals = listTerminals();
      return Response.json({ terminals });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}

// GET: SSE stream for terminal output
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return new Response("id query parameter required", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: string) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Send initial connection event
      sendEvent("connected", id);

      const cleanupOutput = onTerminalOutput(id, (data) => {
        try {
          sendEvent("output", data);
        } catch {
          // Stream closed
        }
      });

      const cleanupExit = onTerminalExit(id, () => {
        try {
          sendEvent("exit", id);
          controller.close();
        } catch {
          // Stream already closed
        }
      });

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        cleanupOutput();
        cleanupExit();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
