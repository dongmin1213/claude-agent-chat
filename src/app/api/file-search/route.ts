import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const IGNORED_DIRS = new Set([
  "node_modules", ".next", ".git", ".vs", "bin", "obj",
  "build", "dist", "packages", ".cache", ".turbo", "__pycache__",
  ".dart_tool", ".idea", "coverage",
]);

const MAX_RESULTS = 200;
const MAX_DEPTH = 8;

async function searchFiles(
  dir: string,
  query: string,
  results: { name: string; path: string; relativePath: string }[],
  baseDir: string,
  depth: number
): Promise<void> {
  if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const lowerQuery = query.toLowerCase();

    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) break;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await searchFiles(fullPath, query, results, baseDir, depth + 1);
      } else if (entry.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          name: entry.name,
          path: fullPath,
          relativePath: path.relative(baseDir, fullPath).replace(/\\/g, "/"),
        });
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

export async function GET(request: NextRequest) {
  const dir = request.nextUrl.searchParams.get("dir");
  const query = request.nextUrl.searchParams.get("q");

  if (!dir || !query) {
    return Response.json({ error: "dir and q are required" }, { status: 400 });
  }

  if (query.length < 1) {
    return Response.json({ results: [] });
  }

  const results: { name: string; path: string; relativePath: string }[] = [];
  await searchFiles(dir, query, results, dir, 0);

  // Sort: exact name match first, then by path length (shorter = more relevant)
  results.sort((a, b) => {
    const aExact = a.name.toLowerCase() === query.toLowerCase() ? 0 : 1;
    const bExact = b.name.toLowerCase() === query.toLowerCase() ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.relativePath.length - b.relativePath.length;
  });

  return Response.json({ results });
}
