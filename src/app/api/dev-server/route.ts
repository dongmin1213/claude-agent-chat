import { NextRequest } from "next/server";
import {
  startServer,
  stopServer,
  getStatus,
  getPortStatus,
  killByPort,
} from "@/lib/dev-server-manager";
import type { ProjectFramework } from "@/types/chat";

export const runtime = "nodejs";

interface RequestBody {
  action: "start" | "stop" | "status" | "kill-port";
  cwd: string;
  port?: number;
  framework?: ProjectFramework;
  customCommand?: string;
}

// Build the correct command and args for each framework
function buildCommand(
  framework: ProjectFramework,
  port: number,
  customCommand?: string
): { command: string; args: string[] } {
  // If user provides a custom command, use it
  if (customCommand) {
    const parts = customCommand.split(" ");
    return { command: parts[0], args: parts.slice(1) };
  }

  switch (framework) {
    case "nextjs":
      return { command: "npm", args: ["run", "dev", "--", "--port", port.toString()] };
    case "vite":
    case "svelte":
    case "astro":
      return { command: "npm", args: ["run", "dev", "--", "--port", port.toString()] };
    case "cra":
      // CRA uses PORT env var (handled in manager via env)
      return { command: "npm", args: ["start"] };
    case "vue-cli":
      return { command: "npm", args: ["run", "serve", "--", "--port", port.toString()] };
    case "angular":
      return { command: "npm", args: ["start", "--", "--port", port.toString()] };
    case "nuxt":
      return { command: "npm", args: ["run", "dev", "--", "--port", port.toString()] };
    case "remix":
      return { command: "npm", args: ["run", "dev"] };
    case "flutter":
      return { command: "flutter", args: ["run", "-d", "web-server", `--web-port=${port}`] };
    default:
      return { command: "npm", args: ["run", "dev"] };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { action, cwd } = body;

    if (!cwd) {
      return Response.json({ error: "cwd is required" }, { status: 400 });
    }

    switch (action) {
      case "start": {
        const port = body.port || 3000;
        const framework = body.framework || "unknown";
        const { command, args } = buildCommand(framework, port, body.customCommand);

        const result = startServer(cwd, command, args, port);
        return Response.json(result);
      }

      case "stop": {
        const result = await stopServer(cwd);
        return Response.json(result);
      }

      case "status": {
        const managed = getStatus(cwd);
        const port = body.port || managed.port || 3000;

        // If we're tracking a running/starting server, return that
        if (managed.status !== "stopped") {
          return Response.json(managed);
        }

        // Otherwise, check if the port is occupied by an orphan process
        const portStatus = await getPortStatus(port, cwd);
        if (portStatus.inUse && !portStatus.managed) {
          return Response.json({
            status: "port_occupied",
            port,
            url: `http://localhost:${port}`,
            error: null,
            pid: portStatus.pid ?? null,
          });
        }

        return Response.json(managed);
      }

      case "kill-port": {
        const port = body.port;
        if (!port) {
          return Response.json({ error: "port is required" }, { status: 400 });
        }
        const result = await killByPort(port);
        return Response.json(result);
      }

      default:
        return Response.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
