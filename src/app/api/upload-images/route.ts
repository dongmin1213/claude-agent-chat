import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export const runtime = "nodejs";

// Allow up to 20MB for image uploads
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { images, cwd } = (await request.json()) as {
      images: string[];
      cwd?: string;
    };

    if (!images || images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const dir = cwd || tmpdir();
    const tempDir = join(dir, ".claude-images");

    try {
      await mkdir(tempDir, { recursive: true });
    } catch {
      // ignore if exists
    }

    const paths: string[] = [];

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
      } catch {
        // skip on write error
      }
    }

    return NextResponse.json({ paths });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
