import { NextRequest } from "next/server";
import { readFile, stat } from "fs/promises";
import { basename, extname } from "path";

const MIME_MAP: Record<string, string> = {
  ".apk": "application/vnd.android.package-archive",
  ".aab": "application/x-authorware-bin",
  ".ipa": "application/octet-stream",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".ts": "application/typescript",
  ".exe": "application/octet-stream",
  ".msi": "application/octet-stream",
  ".dmg": "application/octet-stream",
  ".deb": "application/octet-stream",
  ".rpm": "application/octet-stream",
  ".log": "text/plain",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "application/toml",
  ".sql": "application/sql",
  ".db": "application/octet-stream",
  ".sqlite": "application/octet-stream",
};

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");

  if (!filePath) {
    return new Response("Missing path parameter", { status: 400 });
  }

  try {
    // Check file exists and get size
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return new Response("Not a file", { status: 400 });
    }

    const data = await readFile(filePath);
    const fileName = basename(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";

    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": String(data.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "File not found";
    return new Response(message, { status: 404 });
  }
}
