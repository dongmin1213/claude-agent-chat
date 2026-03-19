import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export const runtime = "nodejs";
export const maxDuration = 1800; // 30 minutes (agents can run long tasks)

// Prevent "nested session" error — must happen at module level
// so it persists across hot reloads in dev mode
delete process.env.CLAUDECODE;

// ── Active stream tracking for abort support ──
// Maps streamId → AbortController so abort endpoint can signal cancellation
const activeStreams = new Map<string, AbortController>();

export function getActiveStreams() {
  return activeStreams;
}

let streamIdCounter = 0;
function generateStreamId(): string {
  return `stream-${Date.now()}-${++streamIdCounter}`;
}

// Save base64 data URL images to temp files, return file paths
async function saveImagesToTemp(images: string[], cwd?: string): Promise<string[]> {
  const paths: string[] = [];
  const dir = cwd || tmpdir();
  const tempDir = join(dir, ".claude-images");

  try {
    await mkdir(tempDir, { recursive: true });
  } catch {
    // ignore if exists
  }

  for (let i = 0; i < images.length; i++) {
    const dataUrl = images[i];
    // Parse data URL: data:image/png;base64,xxxx
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) continue;

    const ext = match[1] === "jpeg" ? "jpg" : match[1];
    const base64Data = match[2];
    const fileName = `pasted-${Date.now()}-${i}.${ext}`;
    const filePath = join(tempDir, fileName);

    try {
      await writeFile(filePath, Buffer.from(base64Data, "base64"));
      paths.push(filePath);
    } catch {
      // skip on write error
    }
  }

  return paths;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { message, sessionId, model, cwd, systemPrompt, maxTurns, maxBudgetUsd, mcpServers, images } = body as {
    message: string;
    sessionId?: string;
    model?: string;
    cwd?: string;
    systemPrompt?: string;
    maxTurns?: number;
    maxBudgetUsd?: number;
    mcpServers?: { id: string; name: string; type: "stdio" | "sse"; command: string; args: string[]; url: string; enabled: boolean }[];
    images?: string[];
  };

  // Allow empty text if images are attached
  if ((!message || typeof message !== "string") && (!images || images.length === 0)) {
    return new Response(JSON.stringify({ error: "message or images required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Images are now pre-saved file paths (uploaded via /api/upload-images)
  // Fallback: if images look like base64 data URLs, save them to temp files
  let prompt = message || "";
  if (images && images.length > 0) {
    let imagePaths: string[];
    const hasDataUrls = images.some((img) => img.startsWith("data:"));
    if (hasDataUrls) {
      imagePaths = await saveImagesToTemp(images, cwd);
    } else {
      // Already file paths
      imagePaths = images;
    }
    if (imagePaths.length > 0) {
      const imageRefs = imagePaths.map((p) => `[Attached Image: ${p}]`).join("\n");
      prompt = prompt ? `${imageRefs}\n\n${prompt}` : `${imageRefs}\n\nPlease analyze these images.`;
    }
  }

  // Create abort controller for this stream
  const streamId = generateStreamId();
  const abortController = new AbortController();
  activeStreams.set(streamId, abortController);

  // Also listen for client disconnect (Next.js request signal)
  const requestSignal = request.signal;
  const onRequestAbort = () => {
    abortController.abort();
  };
  if (requestSignal) {
    requestSignal.addEventListener("abort", onRequestAbort, { once: true });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send stream ID to frontend so it can call abort endpoint
        const initEvent = { type: "stream_init", streamId };
        controller.enqueue(encoder.encode(JSON.stringify(initEvent) + "\n"));

        const agentStream = runAgent({
          prompt,
          sessionId: sessionId || undefined,
          model: model || undefined,
          cwd: cwd || undefined,
          systemPrompt: systemPrompt || undefined,
          maxTurns: maxTurns || undefined,
          maxBudgetUsd: maxBudgetUsd || undefined,
          mcpServers: mcpServers || undefined,
          signal: abortController.signal,
        });

        let eventCount = 0;
        let firstEventReceived = false;

        // Timeout for initial SDK connection (60s)
        const initTimeout = setTimeout(() => {
          if (!firstEventReceived) {
            console.error(`[chat] TIMEOUT: No response from SDK after 60s`);
            const errorEvent = {
              type: "error",
              message: "SDK connection timeout (60s). The Claude CLI process may not be responding. Try closing other Claude sessions and retry.",
            };
            try {
              controller.enqueue(encoder.encode(JSON.stringify(errorEvent) + "\n"));
              controller.close();
            } catch {
              // Stream already closed
            }
          }
        }, 60_000);

        for await (const event of agentStream) {
          // Check if aborted
          if (abortController.signal.aborted) {
            break;
          }
          if (!firstEventReceived) {
            firstEventReceived = true;
            clearTimeout(initTimeout);
          }
          eventCount++;
          const line = JSON.stringify(event) + "\n";
          controller.enqueue(encoder.encode(line));
        }
        clearTimeout(initTimeout);
      } catch (err) {
        // Don't emit error for aborted streams
        if (abortController.signal.aborted) {
          return;
        }
        const errorEvent = {
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        };
        controller.enqueue(encoder.encode(JSON.stringify(errorEvent) + "\n"));
      } finally {
        // Clean up
        activeStreams.delete(streamId);
        if (requestSignal) {
          requestSignal.removeEventListener("abort", onRequestAbort);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
