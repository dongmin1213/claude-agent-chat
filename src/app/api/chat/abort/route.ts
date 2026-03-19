import { NextRequest } from "next/server";
import { getActiveStreams } from "../route";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { streamId } = body as { streamId?: string };

  if (!streamId) {
    return new Response(JSON.stringify({ error: "streamId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const activeStreams = getActiveStreams();
  const controller = activeStreams.get(streamId);

  if (controller) {
    controller.abort();
    activeStreams.delete(streamId);
    console.log(`[abort] Stream ${streamId} aborted by user`);
    return new Response(JSON.stringify({ success: true, streamId }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Stream not found — may have already completed
  return new Response(JSON.stringify({ success: true, streamId, note: "stream not found (may have completed)" }), {
    headers: { "Content-Type": "application/json" },
  });
}
