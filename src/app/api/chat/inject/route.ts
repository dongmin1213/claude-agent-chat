import { NextRequest } from "next/server";
import { getActiveSessions } from "../route";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export const runtime = "nodejs";

// Save base64 data URL images to temp files, return file paths
async function saveImagesToTemp(images: string[], cwd?: string): Promise<string[]> {
  const paths: string[] = [];
  const dir = cwd || tmpdir();
  const tempDir = join(dir, ".claude-images");

  try { await mkdir(tempDir, { recursive: true }); } catch { /* exists */ }

  for (let i = 0; i < images.length; i++) {
    const dataUrl = images[i];
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) continue;

    const ext = match[1] === "jpeg" ? "jpg" : match[1];
    const base64Data = match[2];
    const fileName = `pasted-${Date.now()}-${i}.${ext}`;
    const filePath = join(tempDir, fileName);

    try {
      await writeFile(filePath, Buffer.from(base64Data, "base64"));
      paths.push(filePath);
    } catch { /* skip */ }
  }

  return paths;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { streamId, message, images, cwd } = body as {
    streamId: string;
    message: string;
    images?: string[];
    cwd?: string;
  };

  if (!streamId) {
    return new Response(JSON.stringify({ error: "streamId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessions = getActiveSessions();
  const session = sessions.get(streamId);

  if (!session || session.isFinished) {
    return new Response(JSON.stringify({ error: "stream not found or already finished" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Handle images — save base64 to temp files if needed
  let imagePaths: string[] | undefined;
  if (images && images.length > 0) {
    const hasDataUrls = images.some((img) => img.startsWith("data:"));
    imagePaths = hasDataUrls ? await saveImagesToTemp(images, cwd) : images;
  }

  const success = await session.injectMessage(message || "", imagePaths);

  if (!success) {
    return new Response(JSON.stringify({ error: "injection failed — session may have ended" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
