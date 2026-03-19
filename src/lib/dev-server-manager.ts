import { ChildProcess, spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import { createConnection } from "net";

// =========================================
// Types
// =========================================

export interface RunningServer {
  process: ChildProcess;
  port: number;
  url: string;
  cwd: string;
  status: "starting" | "running" | "error";
  error: string | null;
  logs: string[];
  emitter: EventEmitter;
}

export interface LogEvent {
  type: "log" | "status";
  text?: string;
  stream?: "stdout" | "stderr";
  status?: string;
  url?: string;
  error?: string;
}

export interface PortStatus {
  inUse: boolean;
  pid?: number;
  managed: boolean; // true if we're tracking this server in our Map
}

// =========================================
// Module-level state (persists across API requests)
// =========================================

const runningServers = new Map<string, RunningServer>();
const MAX_LOGS = 500;

// Ready detection patterns
const READY_PATTERNS = [
  /ready.*on.*http/i,
  /Local:\s+http/i,
  /compiled successfully/i,
  /listening on port/i,
  /started server on/i,
  /server running at/i,
  /http:\/\/localhost:\d+/i,
  /webpack compiled/i,
  /Network:\s+http/i,
  /VITE.*ready/i,
  /Serving at/i,
];

// FATAL error patterns — these mean the server truly can't run
const FATAL_ERROR_PATTERNS = [
  /EADDRINUSE/i,
  /port.*already in use/i,
  /Cannot find module/i,
  /ENOENT.*package\.json/i,
  /Module not found/i,
];

// =========================================
// Helpers
// =========================================

function normalizeKey(cwd: string): string {
  return cwd.replace(/\\/g, "/").toLowerCase();
}

function appendLog(server: RunningServer, text: string) {
  server.logs.push(text);
  if (server.logs.length > MAX_LOGS) {
    server.logs.splice(0, server.logs.length - MAX_LOGS);
  }
}

// =========================================
// Port utilities
// =========================================

/** Check if a port is in use by attempting a TCP connection */
export function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true); // port is in use
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false); // port is free
    });
  });
}

/** Find PID using a specific port (Windows: netstat, Unix: lsof) */
export function findPidByPort(port: number): number | null {
  try {
    if (process.platform === "win32") {
      const output = execSync(
        `netstat -ano | findstr :${port} | findstr LISTENING`,
        { encoding: "utf-8", timeout: 5000, windowsHide: true }
      );
      const lines = output.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid && pid > 0) return pid;
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      });
      const pid = parseInt(output.trim().split("\n")[0], 10);
      if (pid && pid > 0) return pid;
    }
  } catch {
    // Command failed = no process on this port
  }
  return null;
}

/** Get full port status: is it in use, by whom, and do we manage it */
export async function getPortStatus(port: number, cwd?: string): Promise<PortStatus> {
  const inUse = await checkPort(port);
  if (!inUse) {
    return { inUse: false, managed: false };
  }

  // Check if WE are managing this port
  let managed = false;
  if (cwd) {
    const server = getServer(cwd);
    if (server && server.port === port) {
      managed = true;
    }
  }

  // Also check across all managed servers
  if (!managed) {
    for (const [, server] of runningServers) {
      if (server.port === port) {
        managed = true;
        break;
      }
    }
  }

  const pid = findPidByPort(port);
  return { inUse: true, pid: pid ?? undefined, managed };
}

/** Kill a process by port (for orphan cleanup) */
export async function killByPort(port: number): Promise<{ killed: boolean; pid?: number }> {
  const pid = findPidByPort(port);
  if (!pid) {
    return { killed: false };
  }

  try {
    const treeKill = (await import("tree-kill")).default;
    await new Promise<void>((resolve) => {
      treeKill(pid, "SIGTERM", (err) => {
        if (err) {
          try {
            treeKill(pid, "SIGKILL", () => resolve());
          } catch {
            resolve();
          }
        } else {
          resolve();
        }
      });
    });

    // Also remove from our map if we were tracking it
    for (const [key, server] of runningServers) {
      if (server.port === port) {
        server.emitter.removeAllListeners();
        runningServers.delete(key);
        break;
      }
    }

    return { killed: true, pid };
  } catch {
    // Fallback: direct process kill on Windows
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /F /PID ${pid}`, { timeout: 5000, windowsHide: true });
        return { killed: true, pid };
      } catch {
        return { killed: false, pid };
      }
    }
    return { killed: false, pid };
  }
}

// =========================================
// Public API
// =========================================

export function getServer(cwd: string): RunningServer | undefined {
  return runningServers.get(normalizeKey(cwd));
}

export function getStatus(cwd: string): {
  status: string;
  port: number;
  url: string | null;
  error: string | null;
  pid: number | null;
} {
  const server = getServer(cwd);
  if (!server) {
    return { status: "stopped", port: 0, url: null, error: null, pid: null };
  }
  return {
    status: server.status,
    port: server.port,
    url: server.url,
    error: server.error,
    pid: server.process.pid ?? null,
  };
}

export function startServer(
  cwd: string,
  command: string,
  args: string[],
  port: number,
  env?: Record<string, string>
): { status: string; port: number; url: string; pid: number | null; error?: string } {
  const key = normalizeKey(cwd);

  // Already running?
  const existing = runningServers.get(key);
  if (existing && existing.status !== "error") {
    return {
      status: existing.status,
      port: existing.port,
      url: existing.url,
      pid: existing.process.pid ?? null,
    };
  }

  // If previous errored, clean up
  if (existing) {
    try { existing.process.kill(); } catch { /* ignore */ }
    runningServers.delete(key);
  }

  const url = `http://localhost:${port}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const processEnv = {
    ...process.env,
    PORT: port.toString(),
    BROWSER: "none", // prevent CRA from opening browser
    ...env,
  };

  let proc: ChildProcess;
  try {
    proc = spawn(command, args, {
      cwd,
      shell: true,
      env: processEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    return {
      status: "error",
      port,
      url,
      pid: null,
      error: err instanceof Error ? err.message : "Failed to spawn process",
    };
  }

  const server: RunningServer = {
    process: proc,
    port,
    url,
    cwd,
    status: "starting",
    error: null,
    logs: [],
    emitter,
  };
  runningServers.set(key, server);

  // settled = once status transitions to running or error, stop re-processing
  let settled = false;

  const handleOutput = (stream: "stdout" | "stderr") => (data: Buffer) => {
    const text = data.toString();
    const lines = text.split("\n").filter(Boolean);

    for (const line of lines) {
      appendLog(server, line);
      emitter.emit("log", { type: "log", text: line, stream } as LogEvent);

      if (settled) continue;

      // Check ready patterns (both stdout and stderr — Next.js outputs to stderr)
      if (server.status === "starting") {
        for (const pattern of READY_PATTERNS) {
          if (pattern.test(line)) {
            server.status = "running";
            settled = true;
            emitter.emit("log", {
              type: "status",
              status: "running",
              url: server.url,
            } as LogEvent);
            break;
          }
        }
      }

      // Only check FATAL error patterns when still starting
      // Once running, stderr output is normal (warnings, etc.)
      if (server.status === "starting" && !settled) {
        for (const pattern of FATAL_ERROR_PATTERNS) {
          if (pattern.test(line)) {
            server.status = "error";
            server.error = line;
            settled = true;
            emitter.emit("log", {
              type: "status",
              status: "error",
              error: line,
            } as LogEvent);
            break;
          }
        }
      }
    }
  };

  proc.stdout?.on("data", handleOutput("stdout"));
  proc.stderr?.on("data", handleOutput("stderr"));

  proc.on("close", (code) => {
    if (runningServers.get(key) === server) {
      // Only mark as error if it wasn't already stopped intentionally
      if (server.status !== "error") {
        server.status = "error";
        server.error = `Process exited with code ${code}`;
        emitter.emit("log", {
          type: "status",
          status: "error",
          error: server.error,
        } as LogEvent);
      }
      runningServers.delete(key);
    }
    emitter.removeAllListeners();
  });

  proc.on("error", (err) => {
    server.status = "error";
    server.error = err.message;
    emitter.emit("log", {
      type: "status",
      status: "error",
      error: err.message,
    } as LogEvent);
  });

  // Timeout: if not ready in 60s, mark as running anyway (unverified)
  setTimeout(() => {
    if (server.status === "starting" && runningServers.get(key) === server) {
      server.status = "running";
      emitter.emit("log", {
        type: "status",
        status: "running",
        url: server.url,
      } as LogEvent);
    }
  }, 60_000);

  return {
    status: "starting",
    port,
    url,
    pid: proc.pid ?? null,
  };
}

export async function stopServer(cwd: string): Promise<{ status: string }> {
  const key = normalizeKey(cwd);
  const server = runningServers.get(key);

  if (!server) {
    return { status: "stopped" };
  }

  const pid = server.process.pid;
  const port = server.port;
  server.status = "error"; // Prevent close handler from re-emitting
  runningServers.delete(key);

  if (pid) {
    try {
      const treeKill = (await import("tree-kill")).default;
      await new Promise<void>((resolve) => {
        treeKill(pid, "SIGTERM", (err) => {
          if (err) {
            // Fallback: force kill
            try {
              treeKill(pid, "SIGKILL", () => resolve());
            } catch {
              resolve();
            }
          } else {
            resolve();
          }
        });
      });
    } catch {
      try { server.process.kill(); } catch { /* ignore */ }
    }
  }

  // Double-check: also kill by port in case tree-kill missed child processes
  const stillInUse = await checkPort(port);
  if (stillInUse) {
    await killByPort(port);
  }

  server.emitter.removeAllListeners();
  return { status: "stopped" };
}

export function addLogListener(
  cwd: string,
  listener: (event: LogEvent) => void
): (() => void) | null {
  const server = getServer(cwd);
  if (!server) return null;

  // Send existing logs first
  for (const line of server.logs) {
    listener({ type: "log", text: line, stream: "stdout" });
  }
  // Send current status
  listener({
    type: "status",
    status: server.status,
    url: server.url,
    error: server.error ?? undefined,
  });

  server.emitter.on("log", listener);

  return () => {
    server.emitter.off("log", listener);
  };
}

// =========================================
// Cleanup on process exit
// =========================================

function cleanupAll() {
  for (const [, server] of runningServers) {
    try { server.process.kill(); } catch { /* ignore */ }
  }
  runningServers.clear();
}

process.on("exit", cleanupAll);
process.on("SIGINT", () => { cleanupAll(); process.exit(); });
process.on("SIGTERM", () => { cleanupAll(); process.exit(); });
