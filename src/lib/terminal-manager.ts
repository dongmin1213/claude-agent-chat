import { EventEmitter } from "events";
import { existsSync } from "fs";
import os from "os";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pty: any = null;

async function getPty() {
  if (!pty) {
    try {
      // Dynamic import for node-pty — handle both ESM default export and CJS
      const mod = await import("node-pty");
      pty = mod.default || mod;
      console.log("[terminal-manager] node-pty loaded successfully, spawn:", typeof pty.spawn);
    } catch (err) {
      console.error("[terminal-manager] Failed to load node-pty:", err);
      throw new Error("node-pty is not installed or failed to load. Run: npm install node-pty");
    }
  }
  return pty;
}

export interface TerminalInstance {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process: any; // IPty
  cwd: string;
  createdAt: number;
}

// Module-level state (survives HMR in dev)
const globalKey = "__terminalManager__";

interface TerminalManagerState {
  terminals: Map<string, TerminalInstance>;
  emitter: EventEmitter;
}

function getState(): TerminalManagerState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g[globalKey]) {
    g[globalKey] = {
      terminals: new Map<string, TerminalInstance>(),
      emitter: new EventEmitter(),
    };
    g[globalKey].emitter.setMaxListeners(50);
  }
  return g[globalKey];
}

export async function createTerminal(id: string, cwd: string, cols = 80, rows = 24): Promise<TerminalInstance> {
  const state = getState();

  // Kill existing terminal with same ID
  if (state.terminals.has(id)) {
    await killTerminal(id);
  }

  const nodePty = await getPty();

  // Determine shell based on platform
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
  const args = isWindows ? ["-NoLogo", "-NoExit"] : ["--login"];

  // Validate cwd exists, fallback to Desktop → home → process.cwd()
  const desktopPath = path.join(os.homedir(), "Desktop");
  const fallbackCwd = existsSync(desktopPath) ? desktopPath : os.homedir();
  const targetCwd = (cwd && existsSync(cwd)) ? cwd : fallbackCwd;

  // Filter out undefined env values (node-pty requires string values)
  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      cleanEnv[key] = value;
    }
  }

  console.log(`[terminal-manager] Creating terminal ${id}: shell=${shell}, cwd=${targetCwd}, cols=${cols}, rows=${rows}`);

  const proc = nodePty.spawn(shell, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: targetCwd,
    env: cleanEnv,
  });

  const instance: TerminalInstance = {
    id,
    process: proc,
    cwd: targetCwd,
    createdAt: Date.now(),
  };

  state.terminals.set(id, instance);

  // Forward output to event emitter
  proc.onData((data: string) => {
    state.emitter.emit(`output:${id}`, data);
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    console.log(`[terminal-manager] Terminal ${id} exited: code=${exitCode}, signal=${signal}`);
    state.emitter.emit(`exit:${id}`);
    state.terminals.delete(id);
  });

  return instance;
}

export function writeTerminal(id: string, data: string): boolean {
  const state = getState();
  const instance = state.terminals.get(id);
  if (!instance) return false;
  instance.process.write(data);
  return true;
}

export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const state = getState();
  const instance = state.terminals.get(id);
  if (!instance) return false;
  try {
    instance.process.resize(cols, rows);
  } catch {
    // Ignore resize errors
  }
  return true;
}

export async function killTerminal(id: string): Promise<boolean> {
  const state = getState();
  const instance = state.terminals.get(id);
  if (!instance) return false;
  try {
    instance.process.kill();
  } catch {
    // Already dead
  }
  state.terminals.delete(id);
  return true;
}

export function listTerminals(): { id: string; cwd: string; createdAt: number }[] {
  const state = getState();
  return Array.from(state.terminals.values()).map((t) => ({
    id: t.id,
    cwd: t.cwd,
    createdAt: t.createdAt,
  }));
}

export function onTerminalOutput(id: string, callback: (data: string) => void): () => void {
  const state = getState();
  state.emitter.on(`output:${id}`, callback);
  return () => state.emitter.off(`output:${id}`, callback);
}

export function onTerminalExit(id: string, callback: () => void): () => void {
  const state = getState();
  state.emitter.on(`exit:${id}`, callback);
  return () => state.emitter.off(`exit:${id}`, callback);
}
