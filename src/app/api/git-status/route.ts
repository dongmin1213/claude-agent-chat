import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

export async function GET(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("dir");
  if (!dir) {
    return Response.json({ error: "dir is required" }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "-uall"], {
      cwd: dir,
      timeout: 10000,
      windowsHide: true,
    });

    const files: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const status = line.substring(0, 2).trim();
      const filePath = line.substring(3).trim();
      // Handle renamed files (e.g., "R  old -> new")
      const actualPath = filePath.includes(" -> ") ? filePath.split(" -> ")[1] : filePath;
      files[actualPath] = status;
    }

    return Response.json({ files, isGit: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Not a git repo or git not available
    if (message.includes("not a git repository") || message.includes("ENOENT")) {
      return Response.json({ files: {}, isGit: false });
    }
    return Response.json({ files: {}, isGit: false, error: message });
  }
}
