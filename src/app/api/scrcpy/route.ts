import { NextRequest } from "next/server";
import {
  detectAdbDevices,
  connectMumuAdb,
  getScrcpyStatus,
  startScrcpyServer,
  stopScrcpyServer,
  addScrcpyLogListener,
} from "@/lib/scrcpy-manager";

export const runtime = "nodejs";

interface RequestBody {
  action: "devices" | "connect-mumu" | "start" | "stop" | "status";
  wsScrcpyPath?: string;
  port?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { action } = body;

    switch (action) {
      case "devices": {
        const devices = detectAdbDevices();
        return Response.json({ devices });
      }

      case "connect-mumu": {
        const connected = connectMumuAdb();
        const devices = detectAdbDevices();
        return Response.json({ connected, devices });
      }

      case "start": {
        const wsScrcpyPath = body.wsScrcpyPath || "";
        const port = body.port || 8000;
        const result = startScrcpyServer(wsScrcpyPath, port);
        return Response.json(result);
      }

      case "stop": {
        const result = await stopScrcpyServer();
        return Response.json(result);
      }

      case "status": {
        const result = await getScrcpyStatus();
        return Response.json(result);
      }

      default:
        return Response.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// SSE endpoint for scrcpy logs
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch { /* stream closed */ }
      };

      const unsub = addScrcpyLogListener((event) => {
        send(JSON.stringify(event));
      });

      if (!unsub) {
        send(JSON.stringify({ type: "status", status: "stopped" }));
        controller.close();
        return;
      }

      // Keep alive ping
      const ping = setInterval(() => {
        try { send("ping"); } catch { clearInterval(ping); }
      }, 30_000);

      // Cleanup when client disconnects (handled by request abort)
      const cleanup = () => {
        clearInterval(ping);
        unsub();
      };

      // Store cleanup for abort
      (controller as unknown as { _cleanup: () => void })._cleanup = cleanup;
    },
    cancel(controller) {
      const c = controller as unknown as { _cleanup?: () => void };
      c._cleanup?.();
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
