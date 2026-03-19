import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

export const runtime = "nodejs";

// Resolve Desktop path (works on Windows, macOS, Linux)
function getDesktopPath(): string | null {
  try {
    const desktop = path.join(os.homedir(), "Desktop");
    return desktop;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("dir") || process.cwd();

  const dirsOnly = request.nextUrl.searchParams.get("dirsOnly") === "true";

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = entries
      .filter((e) => e.name !== "node_modules" && (!dirsOnly || e.isDirectory()))
      .map((e) => ({
        name: e.name,
        path: path.join(dir, e.name),
        isDirectory: e.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });

    return Response.json({ items, cwd: dir, desktopPath: getDesktopPath() });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return Response.json({ items: [], cwd: dir, error: `Directory not found: ${dir}` }, { status: 404 });
    }
    if (code === "EACCES" || code === "EPERM") {
      return Response.json({ items: [], cwd: dir, error: `Permission denied: ${dir}` }, { status: 403 });
    }
    return Response.json({ items: [], cwd: dir, error: "Failed to read directory" }, { status: 500 });
  }
}
