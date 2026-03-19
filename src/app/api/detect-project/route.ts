import { NextRequest } from "next/server";
import { detectProject } from "@/lib/detect-project";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("dir");
  if (!dir) {
    return Response.json({ error: "dir is required" }, { status: 400 });
  }

  try {
    const fs = await import("fs");
    const path = await import("path");
    const info = detectProject(fs.default, path.default, dir);
    return Response.json(info);
  } catch (err) {
    return Response.json({
      framework: "unknown",
      name: dir.split(/[\\/]/).pop() || "project",
      devCommand: "",
      defaultPort: 3000,
      isFlutter: false,
      error: err instanceof Error ? err.message : "Detection failed",
    });
  }
}
