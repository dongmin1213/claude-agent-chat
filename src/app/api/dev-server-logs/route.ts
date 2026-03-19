import { NextRequest } from "next/server";
import { addLogListener } from "@/lib/dev-server-manager";
import type { LogEvent } from "@/lib/dev-server-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd");
  if (!cwd) {
    return Response.json({ error: "cwd is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`)
      );

      const listener = (event: LogEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Stream closed
        }
      };

      const unsubscribe = addLogListener(cwd, listener);

      if (!unsubscribe) {
        // No server running for this cwd
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "status", status: "stopped" })}\n\n`
          )
        );
        controller.close();
        return;
      }

      // Clean up on client disconnect
      request.signal.addEventListener("abort", () => {
        unsubscribe();
      });
    },
    cancel() {
      // Stream cancelled by client
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
