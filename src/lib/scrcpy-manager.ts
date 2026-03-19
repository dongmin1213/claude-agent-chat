import { ChildProcess, spawn, execSync } from "child_process";
import { createConnection } from "net";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

// =========================================
// Types
// =========================================

export interface AdbDevice {
  id: string;          // e.g. "127.0.0.1:16384"
  status: string;      // "device" | "offline" | "unauthorized"
  model?: string;
  product?: string;
}

export interface ScrcpyServer {
  process: ChildProcess;
  port: number;
  url: string;
  status: "starting" | "running" | "error";
  error: string | null;
  logs: string[];
  emitter: EventEmitter;
}

export interface ScrcpyLogEvent {
  type: "log" | "status";
  text?: string;
  stream?: "stdout" | "stderr";
  status?: string;
  url?: string;
  error?: string;
}

// =========================================
// Module-level state (HMR-safe via globalThis)
// =========================================

const GLOBAL_KEY = "__scrcpyServer__";
const globalAny = globalThis as Record<string, unknown>;

function getServer(): ScrcpyServer | null {
  return (globalAny[GLOBAL_KEY] as ScrcpyServer) || null;
}
function setServer(s: ScrcpyServer | null) {
  globalAny[GLOBAL_KEY] = s;
}

const MAX_LOGS = 300;

// ws-scrcpy ready patterns
const SCRCPY_READY_PATTERNS = [
  /listening on/i,
  /http.*:\d+/i,
  /server started/i,
  /Websocket/i,
  /started on port/i,
];

// Ensure ADB is in PATH
function getAdbEnhancedPath(): string {
  const adbPaths = [
    path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", "Android", "Sdk", "platform-tools"),
  ].filter(Boolean);
  const currentPath = process.env.PATH || process.env.Path || "";
  return [...adbPaths, currentPath].join(path.delimiter);
}

// TCP port check (is something listening?)
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(1000);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => { resolve(false); });
  });
}

// =========================================
// ADB Device Detection
// =========================================

export function detectAdbDevices(): AdbDevice[] {
  try {
    const envPath = getAdbEnhancedPath();
    const output = execSync("adb devices -l", {
      encoding: "utf-8",
      timeout: 10000,
      windowsHide: true,
      env: { ...process.env, PATH: envPath, Path: envPath },
    });

    const devices: AdbDevice[] = [];
    const lines = output.trim().split("\n").slice(1); // skip "List of devices attached"

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;

      const id = parts[0];
      const status = parts[1];

      // Extract model/product from key:value pairs
      let model: string | undefined;
      let product: string | undefined;
      for (const part of parts.slice(2)) {
        if (part.startsWith("model:")) model = part.split(":")[1];
        if (part.startsWith("product:")) product = part.split(":")[1];
      }

      devices.push({ id, status, model, product });
    }

    return devices;
  } catch {
    return [];
  }
}

/** Try to connect to MuMu Player — stop after first success */
export function connectMumuAdb(): string[] {
  const ports = [16384, 7555, 5555, 62001];
  const connected: string[] = [];
  const envPath = getAdbEnhancedPath();

  for (const port of ports) {
    try {
      const output = execSync(`adb connect 127.0.0.1:${port}`, {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
        env: { ...process.env, PATH: envPath, Path: envPath },
      });
      if (output.includes("connected")) {
        connected.push(`127.0.0.1:${port}`);
        break; // 하나 연결되면 중단 (같은 에뮬레이터 중복 방지)
      }
    } catch {
      // Ignore
    }
  }

  return connected;
}

// =========================================
// ws-scrcpy Server Management
// =========================================

export async function getScrcpyStatus(): Promise<{
  status: string;
  port: number;
  url: string | null;
  error: string | null;
  pid: number | null;
}> {
  const server = getServer();
  if (server) {
    return {
      status: server.status,
      port: server.port,
      url: server.url,
      error: server.error,
      pid: server.process.pid ?? null,
    };
  }
  return { status: "stopped", port: 0, url: null, error: null, pid: null };
}

export function startScrcpyServer(
  wsScrcpyPath: string,
  port: number = 8000
): { status: string; port: number; url: string; pid: number | null; error?: string } {
  const existing = getServer();

  // Already running?
  if (existing && existing.status !== "error") {
    return {
      status: existing.status,
      port: existing.port,
      url: existing.url,
      pid: existing.process.pid ?? null,
    };
  }

  // Clean up previous error
  if (existing) {
    try { existing.process.kill(); } catch { /* ignore */ }
    setServer(null);
  }

  if (!wsScrcpyPath) {
    return {
      status: "error",
      port,
      url: "",
      pid: null,
      error: "ws-scrcpy path is not configured. Set it in Settings → Device tab.",
    };
  }

  // Determine the dist directory (where index.js lives)
  const distDir = fs.existsSync(path.join(wsScrcpyPath, "dist", "index.js"))
    ? path.join(wsScrcpyPath, "dist")
    : fs.existsSync(path.join(wsScrcpyPath, "index.js"))
      ? wsScrcpyPath
      : null;

  if (!distDir) {
    return {
      status: "error",
      port,
      url: "",
      pid: null,
      error: "ws-scrcpy dist/index.js not found. Run 'npx webpack --config webpack/ws-scrcpy.prod.ts' in the ws-scrcpy directory first.",
    };
  }

  // Create a temporary YAML config to set the port
  const configYaml = `server:\n  - secure: false\n    port: ${port}\n`;
  const configPath = path.join(distDir, "_ws-scrcpy-config.yaml");
  try {
    fs.writeFileSync(configPath, configYaml, "utf-8");
  } catch {
    // If we can't write config, ws-scrcpy will use default port 8000
  }

  const url = `http://localhost:${port}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const enhancedPath = getAdbEnhancedPath();

  let proc: ChildProcess;
  try {
    // Run dist/index.js directly (skip rebuild)
    proc = spawn("node", ["index.js"], {
      cwd: distDir,
      shell: true,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: enhancedPath,
        Path: enhancedPath,
        WS_SCRCPY_CONFIG: configPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return {
      status: "error",
      port,
      url,
      pid: null,
      error: err instanceof Error ? err.message : "Failed to start ws-scrcpy",
    };
  }

  const server: ScrcpyServer = {
    process: proc,
    port,
    url,
    status: "starting",
    error: null,
    logs: [],
    emitter,
  };
  setServer(server);

  const handleOutput = (stream: "stdout" | "stderr") => (data: Buffer) => {
    const text = data.toString();
    const lines = text.split("\n").filter(Boolean);

    for (const line of lines) {
      server.logs.push(line);
      if (server.logs.length > MAX_LOGS) {
        server.logs.splice(0, server.logs.length - MAX_LOGS);
      }
      emitter.emit("log", { type: "log", text: line, stream } as ScrcpyLogEvent);

      // Check ready patterns
      if (server.status === "starting") {
        for (const pattern of SCRCPY_READY_PATTERNS) {
          if (pattern.test(line)) {
            server.status = "running";
            emitter.emit("log", {
              type: "status",
              status: "running",
              url: server.url,
            } as ScrcpyLogEvent);
            break;
          }
        }
      }
    }
  };

  proc.stdout?.on("data", handleOutput("stdout"));
  proc.stderr?.on("data", handleOutput("stderr"));

  proc.on("close", (code) => {
    console.log(`[scrcpy-manager] ws-scrcpy process closed with code ${code}`);
    const current = getServer();
    if (current === server) {
      server.status = "error";
      server.error = `ws-scrcpy exited with code ${code}`;
      emitter.emit("log", {
        type: "status",
        status: "error",
        error: server.error,
      } as ScrcpyLogEvent);
      setServer(null);
    }
    emitter.removeAllListeners();
  });

  proc.on("error", (err) => {
    console.log(`[scrcpy-manager] ws-scrcpy process error: ${err.message}`);
    server.status = "error";
    server.error = err.message;
    emitter.emit("log", {
      type: "status",
      status: "error",
      error: err.message,
    } as ScrcpyLogEvent);
  });

  // Timeout: mark as running after 15s anyway
  setTimeout(() => {
    const current = getServer();
    if (server.status === "starting" && current === server) {
      server.status = "running";
      emitter.emit("log", {
        type: "status",
        status: "running",
        url: server.url,
      } as ScrcpyLogEvent);
    }
  }, 15_000);

  return {
    status: "starting",
    port,
    url,
    pid: proc.pid ?? null,
  };
}

export async function stopScrcpyServer(): Promise<{ status: string }> {
  const server = getServer();
  if (!server) {
    return { status: "stopped" };
  }

  const pid = server.process.pid;
  setServer(null);

  if (pid) {
    try {
      const treeKill = (await import("tree-kill")).default;
      await new Promise<void>((resolve) => {
        treeKill(pid, "SIGTERM", (err) => {
          if (err) {
            try { treeKill(pid, "SIGKILL", () => resolve()); }
            catch { resolve(); }
          } else {
            resolve();
          }
        });
      });
    } catch {
      try { server.process.kill(); } catch { /* ignore */ }
    }
  }

  // Double-check: if port still occupied, force kill
  const portAlive = await checkPort(server.port);
  if (portAlive) {
    try {
      const pidStr = execSync(
        process.platform === "win32"
          ? `netstat -ano | findstr :${server.port} | findstr LISTENING`
          : `lsof -ti :${server.port}`,
        { encoding: "utf-8", timeout: 5000, windowsHide: true }
      ).trim();
      const occupyPid = process.platform === "win32"
        ? parseInt(pidStr.split(/\s+/).pop() || "", 10)
        : parseInt(pidStr.split("\n")[0], 10);
      if (occupyPid && !isNaN(occupyPid)) {
        const treeKill = (await import("tree-kill")).default;
        treeKill(occupyPid, "SIGKILL");
      }
    } catch { /* ignore */ }
  }

  server.emitter.removeAllListeners();
  return { status: "stopped" };
}

export function addScrcpyLogListener(
  listener: (event: ScrcpyLogEvent) => void
): (() => void) | null {
  const server = getServer();
  if (!server) return null;

  // Send existing logs
  for (const line of server.logs) {
    listener({ type: "log", text: line, stream: "stdout" });
  }
  listener({
    type: "status",
    status: server.status,
    url: server.url,
    error: server.error ?? undefined,
  });

  server.emitter.on("log", listener);
  const emitter = server.emitter;

  return () => {
    emitter.off("log", listener);
  };
}

// =========================================
// Cleanup
// =========================================

function cleanup() {
  const server = getServer();
  if (server) {
    try { server.process.kill(); } catch { /* ignore */ }
    setServer(null);
  }
}

process.on("exit", cleanup);
