import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs/promises
const mockStat = vi.fn();
const mockReadFile = vi.fn();
vi.mock("fs/promises", () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import { GET } from "./route";

// NextRequest requires nextUrl.searchParams — create a compatible mock
function makeNextRequest(path?: string) {
  const url = new URL(
    path
      ? `http://localhost:3000/api/download?path=${encodeURIComponent(path)}`
      : "http://localhost:3000/api/download"
  );
  return {
    nextUrl: url,
  } as unknown as import("next/server").NextRequest;
}

describe("/api/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when path is missing", async () => {
    const res = await GET(makeNextRequest());
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Missing path");
  });

  it("returns 404 when file does not exist", async () => {
    mockStat.mockRejectedValue(new Error("ENOENT: no such file"));
    const res = await GET(makeNextRequest("/nonexistent.txt"));
    expect(res.status).toBe(404);
  });

  it("returns 400 for directories", async () => {
    mockStat.mockResolvedValue({ isFile: () => false });
    const res = await GET(makeNextRequest("/some/dir"));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Not a file");
  });

  it("returns file with correct content-type for .apk", async () => {
    mockStat.mockResolvedValue({ isFile: () => true });
    mockReadFile.mockResolvedValue(Buffer.from("fake apk data"));
    const res = await GET(makeNextRequest("/build/app.apk"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.android.package-archive");
    expect(res.headers.get("Content-Disposition")).toContain("app.apk");
  });

  it("returns file with correct content-type for .json", async () => {
    mockStat.mockResolvedValue({ isFile: () => true });
    mockReadFile.mockResolvedValue(Buffer.from('{"key":"val"}'));
    const res = await GET(makeNextRequest("/data/config.json"));
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("defaults to octet-stream for unknown extensions", async () => {
    mockStat.mockResolvedValue({ isFile: () => true });
    mockReadFile.mockResolvedValue(Buffer.from("binary"));
    const res = await GET(makeNextRequest("/file.xyz"));
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});
