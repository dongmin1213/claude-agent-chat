import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import type { StreamEvent } from "@/types/chat";
import type { McpServerConfig } from "@/types/chat";

// Track Claude CLI subprocess PIDs for forceful cleanup on abort
const activeAgentPids = new Map<AbortSignal, Set<number>>();

/**
 * Snapshot child PIDs spawned by the SDK between before/after.
 * On Windows, uses wmic to find claude.exe / node.exe children.
 */
function captureNewChildPids(parentPid: number, knownPids: Set<number>): Set<number> {
  const newPids = new Set<number>();
  try {
    // Find all descendant processes of the Node.js server
    const out = execSync(
      `wmic process where "ParentProcessId=${parentPid}" get ProcessId /format:list`,
      { encoding: "utf-8", timeout: 3000 }
    );
    for (const line of out.split("\n")) {
      const match = line.match(/ProcessId=(\d+)/);
      if (match) {
        const pid = parseInt(match[1], 10);
        if (!knownPids.has(pid)) newPids.add(pid);
      }
    }
  } catch { /* ignore */ }
  return newPids;
}

function killProcessTree(pid: number): void {
  try {
    // On Windows, use taskkill /T to kill entire process tree
    execSync(`taskkill /PID ${pid} /T /F`, { timeout: 5000, stdio: "ignore" });
    console.log(`[agent] Killed process tree for PID ${pid}`);
  } catch {
    // Process may have already exited
  }
}

function forceCleanupAgentProcesses(signal: AbortSignal): void {
  const pids = activeAgentPids.get(signal);
  if (!pids || pids.size === 0) return;
  console.log(`[agent] Force-killing agent subprocess PIDs: ${[...pids].join(", ")}`);
  for (const pid of pids) {
    killProcessTree(pid);
  }
  activeAgentPids.delete(signal);
}

export interface AgentQueryParams {
  prompt: string;
  sessionId?: string;
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  mcpServers?: McpServerConfig[];
}

export async function* runAgent(
  params: AgentQueryParams & { signal?: AbortSignal }
): AsyncGenerator<StreamEvent> {
  // Unset CLAUDECODE env var to prevent "nested session" error
  delete process.env.CLAUDECODE;

  const { prompt, sessionId, cwd, model, systemPrompt, maxTurns, maxBudgetUsd, mcpServers, signal } = params;

  // Build allowedTools list - include MCP tool patterns for enabled servers
  const baseTools = [
    "Read",
    "Edit",
    "Write",
    "Bash",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "Task",
    "ExitPlanMode",
  ];

  // Add MCP tool patterns for enabled servers (format: mcp__<serverName>)
  if (mcpServers && mcpServers.length > 0) {
    const enabledServers = mcpServers.filter((s) => s.enabled);
    for (const server of enabledServers) {
      baseTools.push(`mcp__${server.name}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: Record<string, any> = {
    allowedTools: baseTools,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // Enable real token-level streaming
    includePartialMessages: true,
    // Capture CLI stderr for debugging
    stderr: (data: string) => {
      console.log(`[agent:stderr] ${data.trimEnd()}`);
    },
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  if (cwd) {
    options.cwd = cwd;
  }

  if (model) {
    const modelMap: Record<string, string> = {
      sonnet: "claude-sonnet-4-6",
      opus: "claude-opus-4-6",
      haiku: "claude-haiku-4-5",
    };
    options.model = modelMap[model] || model;
  }

  if (systemPrompt) {
    options.systemPrompt = systemPrompt;
  }

  if (maxTurns && maxTurns > 0) {
    options.maxTurns = maxTurns;
  }

  if (maxBudgetUsd && maxBudgetUsd > 0) {
    options.maxBudgetUsd = maxBudgetUsd;
  }

  // MCP servers — validate before passing to prevent SDK hang on bad configs
  if (mcpServers && mcpServers.length > 0) {
    const enabledServers = mcpServers.filter((s) => s.enabled);
    if (enabledServers.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mcpConfig: Record<string, any> = {};
      for (const server of enabledServers) {
        if (server.type === "sse" && server.url) {
          mcpConfig[server.name] = {
            type: "sse",
            url: server.url,
          };
        } else if (server.command) {
          mcpConfig[server.name] = {
            type: "stdio",
            command: server.command,
            args: server.args || [],
          };
        }
      }
      if (Object.keys(mcpConfig).length > 0) {
        options.mcpServers = mcpConfig;
        // Don't block/hang if MCP server fails to connect
        options.strictMcpConfig = false;
      }
    }
  }

  // Track streaming state to avoid duplicate processing
  let isStreamingText = false;
  // Map of content block index → tool_use_id for streaming tool inputs
  const toolUseBlockMap = new Map<number, { toolUseId: string; toolName: string }>();
  // Track assistant text content for plan content capture
  let currentAssistantText = "";

  // Token usage tracking
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let turnInputTokens = 0;
  let turnOutputTokens = 0;
  let turnCount = 0;

  // Plan mode tracking — preserve assistant text across turns
  let planModeActive = false;
  // Capture Write tool content during plan mode (the actual plan is written to a file)
  let planFileContent = "";

  // ExitPlanMode detection — suppress events and yield plan_approval
  let exitPlanModeDetected = false;
  let exitPlanModeBlockIndex = -1;
  let exitPlanModeToolUseId = "";
  let exitPlanModeInputBuffer = "";

  // AskUserQuestion detection — suppress events and yield ask_user
  let askUserDetected = false;
  let askUserBlockIndex = -1;
  let askUserToolUseId = "";
  let askUserInputBuffer = "";

  try {
    const queryStart = Date.now();
    let messageCount = 0;

    // Also try passing signal to SDK (in case SDK supports it)
    if (signal) {
      options.abortSignal = signal;
    }

    // Snapshot current child processes BEFORE launching SDK
    const serverPid = process.pid;
    const preExistingPids = new Set<number>();
    try {
      const out = execSync(
        `wmic process where "ParentProcessId=${serverPid}" get ProcessId /format:list`,
        { encoding: "utf-8", timeout: 3000 }
      );
      for (const line of out.split("\n")) {
        const match = line.match(/ProcessId=(\d+)/);
        if (match) preExistingPids.add(parseInt(match[1], 10));
      }
    } catch { /* ignore */ }

    // Use manual iteration with Promise.race for immediate abort response
    // (for await...of blocks until next SDK message, making abort checks delayed)
    const queryIterable = query({ prompt, options });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iterator = (queryIterable as any)[Symbol.asyncIterator]();

    // Capture new child PIDs spawned by SDK (claude CLI + MCP servers)
    if (signal) {
      setTimeout(() => {
        const newPids = captureNewChildPids(serverPid, preExistingPids);
        if (newPids.size > 0) {
          activeAgentPids.set(signal, newPids);
          console.log(`[agent] Tracked SDK subprocess PIDs: ${[...newPids].join(", ")}`);
        }
      }, 2000); // Wait 2s for SDK to spawn processes
    }

    // Create a promise that resolves when the abort signal fires
    const ABORT_SENTINEL = Symbol("abort");
    const abortPromise = signal
      ? new Promise<typeof ABORT_SENTINEL>((resolve) => {
          if (signal.aborted) { resolve(ABORT_SENTINEL); return; }
          signal.addEventListener("abort", () => resolve(ABORT_SENTINEL), { once: true });
        })
      : null;

    try {
    while (true) {
      // Race next SDK message against abort signal
      const nextPromise = iterator.next();
      const raceResult = abortPromise
        ? await Promise.race([nextPromise, abortPromise])
        : await nextPromise;

      // Check if abort signal won the race
      if (raceResult === ABORT_SENTINEL || signal?.aborted) {
        console.log(`[agent] Abort signal received — stopping SDK iteration`);
        // Force-kill SDK subprocess tree (Claude CLI + MCP servers)
        if (signal) forceCleanupAgentProcesses(signal);
        yield { type: "status", message: "Aborted by user" };
        return;
      }

      const iterResult = raceResult as IteratorResult<unknown>;
      if (iterResult.done) break;

      const message = iterResult.value;
      messageCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = message as any;

      // 0. Auth status messages — handle authentication issues
      if (msg.type === "auth_status") {
        if (msg.error) {
          yield { type: "error", message: `Authentication error: ${msg.error}` };
        } else if (msg.isAuthenticating) {
          yield { type: "status", message: "Authenticating..." };
        }
        continue;
      }

      // 1. System messages
      if (msg.type === "system") {
        if (msg.subtype === "init") {
          yield { type: "session_init", sessionId: msg.session_id };
        } else if (msg.subtype === "status") {
          // Status updates (compacting, etc.)
          const statusLabel = msg.status || "Processing...";
          yield { type: "status", message: String(statusLabel) };
        } else if (msg.subtype === "compact_boundary") {
          yield { type: "status", message: "Compacting conversation context..." };
        } else if (msg.subtype === "task_notification") {
          // Subagent task completed/failed/stopped
          const taskStatus = msg.status === "completed" ? "✓" : msg.status === "failed" ? "✗" : msg.status === "stopped" ? "⊘" : "○";
          yield { type: "status", message: `Task ${taskStatus}: ${msg.summary || msg.task_id}` };
        } else if (msg.subtype === "task_started" || msg.subtype === "task_progress") {
          // Subagent task lifecycle — silently skip (progress shown via tool streaming)
        } else if (msg.subtype === "files_persisted" || msg.subtype === "elicitation_complete") {
          // Internal SDK events — silently skip
        } else if (msg.subtype === "hook_started" || msg.subtype === "hook_progress" || msg.subtype === "hook_response") {
          // Hook lifecycle — silently skip
        } else if (msg.subtype === "local_command_output") {
          // Local command output — silently skip
        } else {
          // Forward other system messages as status events
          const statusText = msg.subtype || msg.message || msg.description || "Processing...";
          yield { type: "status", message: String(statusText) };
        }
        continue;
      }

      // 1.5. Tool progress messages
      if (msg.type === "tool_progress") {
        continue; // Silently skip — tool progress is shown via streaming
      }

      // 1.6. Other non-critical message types to skip silently
      if (msg.type === "tool_use_summary" || msg.type === "prompt_suggestion" || msg.type === "rate_limit_event") {
        continue;
      }

      // 2. Real-time streaming events (token-level)
      if (msg.type === "stream_event") {
        const event = msg.event;
        if (!event) continue;

        switch (event.type) {
          case "content_block_start": {
            const block = event.content_block;
            if (block?.type === "text") {
              isStreamingText = true;
            } else if (block?.type === "tool_use") {
              // Detect EnterPlanMode — start preserving assistant text
              if (block.name === "EnterPlanMode") {
                planModeActive = true;
              }
              // Detect ExitPlanMode — suppress its events
              if (block.name === "ExitPlanMode") {
                exitPlanModeDetected = true;
                exitPlanModeBlockIndex = event.index;
                exitPlanModeToolUseId = block.id;
                break;
              }
              // Detect AskUserQuestion — suppress its events
              if (block.name === "AskUserQuestion") {
                askUserDetected = true;
                askUserBlockIndex = event.index;
                askUserToolUseId = block.id;
                break;
              }
              toolUseBlockMap.set(event.index, {
                toolUseId: block.id,
                toolName: block.name,
              });
              yield {
                type: "tool_use_start",
                toolName: block.name,
                toolUseId: block.id,
              };
            }
            break;
          }

          case "content_block_delta": {
            const delta = event.delta;
            if (delta?.type === "text_delta" && delta.text) {
              currentAssistantText += delta.text;
              // In plan mode, accumulate text but don't show in chat
              if (!planModeActive) {
                yield { type: "text_delta", text: delta.text };
              }
            } else if (delta?.type === "input_json_delta" && delta.partial_json) {
              // Capture and suppress input deltas for ExitPlanMode
              if (exitPlanModeDetected && event.index === exitPlanModeBlockIndex) {
                exitPlanModeInputBuffer += delta.partial_json;
                break;
              }
              // Capture and suppress input deltas for AskUserQuestion
              if (askUserDetected && event.index === askUserBlockIndex) {
                askUserInputBuffer += delta.partial_json;
                break;
              }
              yield { type: "tool_use_input_delta", partialJson: delta.partial_json };
            }
            break;
          }

          case "content_block_stop": {
            if (isStreamingText) {
              // In plan mode, suppress text_done from chat
              if (!planModeActive) {
                yield { type: "text_done" };
              }
              isStreamingText = false;
            }
            // Tool use content_block_stop is handled by the full assistant message
            break;
          }
        }
        continue;
      }

      // 3. Full assistant message (after streaming completes for this turn)
      if (msg.type === "assistant") {
        // Check for assistant-level errors (rate_limit, authentication_failed, billing_error, etc.)
        if (msg.error) {
          const errorMap: Record<string, string> = {
            authentication_failed: "Authentication failed. Run 'claude' to re-authenticate.",
            billing_error: "Billing error. Check your Claude subscription or API billing.",
            rate_limit: "Rate limited. Please wait a moment and try again.",
            invalid_request: "Invalid request sent to API.",
            server_error: "Claude API server error. Please try again.",
            max_output_tokens: "Response exceeded maximum output tokens.",
            unknown: "Unknown API error occurred.",
          };
          yield {
            type: "error",
            message: errorMap[msg.error] || `API error: ${msg.error}`,
          };
          // Still process any partial content below
        }

        const content = msg.message?.content || msg.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              // Text was already streamed via stream_event, skip
              // But if somehow not streamed, emit as fallback
              if (!isStreamingText && toolUseBlockMap.size === 0) {
                // Fallback: emit complete text if stream_events weren't received
                yield { type: "text_delta", text: block.text };
                yield { type: "text_done" };
              }
            } else if (block.type === "tool_use") {
              // Fallback EnterPlanMode detection — if streaming events missed it
              if (!planModeActive && block.name === "EnterPlanMode") {
                console.log(`[agent][plan] EnterPlanMode detected via full message fallback`);
                planModeActive = true;
              }
              // Fallback ExitPlanMode detection — if streaming events missed it
              if (!exitPlanModeDetected && block.name === "ExitPlanMode") {
                console.log(`[agent][plan] ExitPlanMode detected via full message fallback (id: ${block.id})`);
                exitPlanModeDetected = true;
                exitPlanModeToolUseId = block.id;
                if (block.input) {
                  exitPlanModeInputBuffer = JSON.stringify(block.input);
                }
                continue;
              }
              // Fallback AskUserQuestion detection
              if (!askUserDetected && block.name === "AskUserQuestion") {
                console.log(`[agent] AskUserQuestion detected via full message fallback (id: ${block.id})`);
                askUserDetected = true;
                askUserToolUseId = block.id;
                if (block.input) {
                  askUserInputBuffer = JSON.stringify(block.input);
                }
                continue;
              }
              // Suppress ExitPlanMode tool_use_done
              if (exitPlanModeDetected && block.id === exitPlanModeToolUseId) {
                continue;
              }
              // Suppress AskUserQuestion tool_use_done
              if (askUserDetected && block.id === askUserToolUseId) {
                continue;
              }
              // Capture Write tool content during plan mode — the actual plan
              // is written to a file via Write, not as assistant text
              if (planModeActive && block.name === "Write") {
                const writeContent = block.input?.content || block.input?.file_content || block.input?.text;
                if (writeContent && typeof writeContent === "string") {
                  // Keep the longest Write content (plan file is usually the longest)
                  if (writeContent.length > planFileContent.length) {
                    planFileContent = writeContent;
                  }
                }
                console.log(`[agent][plan] Write tool captured: ${writeContent ? writeContent.length : 0} chars, path: ${block.input?.file_path || "unknown"}`);
              }
              // Emit tool_use_done with complete input
              const tracked = toolUseBlockMap.get(
                content.indexOf(block)
              );
              if (tracked) {
                yield {
                  type: "tool_use_done",
                  toolUseId: tracked.toolUseId,
                  input: block.input || {},
                };
              } else {
                // Tool wasn't tracked from streaming, emit full lifecycle
                yield {
                  type: "tool_use_start",
                  toolName: block.name,
                  toolUseId: block.id,
                };
                yield {
                  type: "tool_use_done",
                  toolUseId: block.id,
                  input: block.input || {},
                };
              }
            }
          }
        }
        // Extract token usage from assistant message
        const usage = msg.message?.usage;
        if (usage) {
          turnInputTokens = usage.input_tokens || 0;
          turnOutputTokens = usage.output_tokens || 0;
          totalInputTokens += turnInputTokens;
          totalOutputTokens += turnOutputTokens;
        }
        turnCount++;

        // Reset per-turn state
        toolUseBlockMap.clear();
        // Don't reset assistant text if we need it for plan content or ask_user
        // Also preserve text while in plan mode (between EnterPlanMode and ExitPlanMode)
        if (!exitPlanModeDetected && !askUserDetected && !planModeActive) {
          currentAssistantText = "";
        }
        yield { type: "turn_done", inputTokens: turnInputTokens, outputTokens: turnOutputTokens };
        continue;
      }

      // 4. User messages with tool results (SDK internal)
      if (msg.type === "user") {
        const content = msg.message?.content || msg.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              // Suppress ExitPlanMode tool_result — but capture content
              // as fallback plan content (SDK may include plan file contents)
              if (exitPlanModeDetected && block.tool_use_id === exitPlanModeToolUseId) {
                if (!planFileContent) {
                  const resultText = Array.isArray(block.content)
                    ? block.content.map((c: { text?: string }) => c.text || "").join("\n")
                    : typeof block.content === "string"
                      ? block.content
                      : "";
                  if (resultText && resultText.trim()) {
                    // Capture any non-empty result (SDK returns plan file contents here)
                    planFileContent = resultText;
                  }
                }
                continue;
              }
              // Suppress AskUserQuestion tool_result
              if (askUserDetected && block.tool_use_id === askUserToolUseId) {
                continue;
              }
              const resultText = Array.isArray(block.content)
                ? block.content
                    .filter((c: { type?: string }) => c.type === "text" || !c.type)
                    .map((c: { text?: string }) => c.text || "")
                    .join("\n")
                : typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content);
              // Extract base64 images from tool result content
              // Supports both Anthropic API format and MCP format
              const images: string[] = [];
              if (Array.isArray(block.content)) {
                for (const c of block.content) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const cb = c as any;
                  if (cb.type === "image") {
                    // Anthropic API format: { type: "image", source: { type: "base64", media_type, data } }
                    if (cb.source?.type === "base64" && cb.source.data) {
                      images.push(`data:${cb.source.media_type || "image/png"};base64,${cb.source.data}`);
                    }
                    // MCP format: { type: "image", data: "base64...", mimeType: "image/png" }
                    else if (cb.data && typeof cb.data === "string") {
                      images.push(`data:${cb.mimeType || "image/png"};base64,${cb.data}`);
                    }
                  }
                }
                if (block.content.length > 0) {
                  const types = block.content.map((c: { type?: string }) => c.type).join(",");
                  console.log(`[agent] tool_result content types: [${types}], images found: ${images.length}`);
                }
              }
              yield {
                type: "tool_result",
                toolUseId: block.tool_use_id,
                content: resultText,
                isError: block.is_error === true,
                ...(images.length > 0 ? { images } : {}),
              };
            }
          }
        }

        // After processing tool results, if ExitPlanMode was detected:
        // yield plan_approval and stop the generator to pause the agent
        if (exitPlanModeDetected) {
          let allowedPrompts: { tool: string; prompt: string }[] | undefined;
          try {
            const parsed = JSON.parse(exitPlanModeInputBuffer);
            if (parsed.allowedPrompts && Array.isArray(parsed.allowedPrompts)) {
              allowedPrompts = parsed.allowedPrompts;
            }
          } catch { /* partial JSON — ignore */ }

          // Priority: Write tool content > ExitPlanMode result > plan file on disk > assistant text
          console.log(`[agent][plan] Resolving plan content — planFileContent: ${planFileContent.length} chars, currentAssistantText: ${currentAssistantText.length} chars`);
          let resolvedPlanContent = planFileContent || undefined;

          // Fallback: try to read the plan file from disk (SDK writes to .claude/plan.md)
          if (!resolvedPlanContent && cwd) {
            const planFilePaths = [
              join(cwd, ".claude", "plan.md"),
              join(cwd, ".claude", "plan"),
              join(cwd, "plan.md"),
              join(cwd, "PLAN.md"),
            ];
            for (const planPath of planFilePaths) {
              try {
                const fileContent = await readFile(planPath, "utf-8");
                if (fileContent && fileContent.trim()) {
                  resolvedPlanContent = fileContent;
                  console.log(`[agent][plan] Read plan file from disk: ${planPath} (${fileContent.length} chars)`);
                  break;
                }
              } catch { /* file doesn't exist — try next */ }
            }
          }

          // Last fallback: use accumulated assistant text from plan mode
          if (!resolvedPlanContent && currentAssistantText && currentAssistantText.trim()) {
            resolvedPlanContent = currentAssistantText;
            console.log(`[agent][plan] Using assistant text as plan content (${currentAssistantText.length} chars)`);
          }

          yield { type: "plan_approval", allowedPrompts, planContent: resolvedPlanContent };
          return; // Stop generator — session is saved, can resume later
        }

        // After processing tool results, if AskUserQuestion was detected:
        // yield ask_user and stop the generator to pause the agent
        if (askUserDetected) {
          let questions: { question: string; header: string; options: { label: string; description: string }[]; multiSelect: boolean }[] = [];
          try {
            const parsed = JSON.parse(askUserInputBuffer);
            if (parsed.questions && Array.isArray(parsed.questions)) {
              questions = parsed.questions;
            }
          } catch { /* partial JSON — ignore */ }
          yield { type: "ask_user", questions };
          return; // Stop generator — session is saved, can resume later
        }
        continue;
      }

      // 5. Result message (final)
      if (msg.type === "result") {
        if (msg.subtype === "success") {
          yield {
            type: "result",
            result: msg.result || "",
            costUsd: msg.total_cost_usd,
            durationMs: msg.duration_ms,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            turnCount,
          };
        } else {
          // error_during_execution | error_max_turns | error_max_budget_usd | error_max_structured_output_retries
          const errorLabels: Record<string, string> = {
            error_during_execution: "Error during execution",
            error_max_turns: "Maximum turns reached",
            error_max_budget_usd: "Budget limit exceeded",
            error_max_structured_output_retries: "Structured output retries exceeded",
          };
          const label = errorLabels[msg.subtype] || msg.subtype;
          yield {
            type: "error",
            message: `${label}${
              msg.errors && msg.errors.length > 0 ? ": " + msg.errors.join(", ") : ""
            }`,
          };
          // Still yield result with cost info for error cases
          yield {
            type: "result",
            result: "",
            costUsd: msg.total_cost_usd,
            durationMs: msg.duration_ms,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            turnCount,
          };
        }
        return; // Exit generator immediately — result is the final message
      }

      // 6. Unhandled message types — log for debugging
      console.log(`[agent] Unhandled message type: ${msg.type}`, msg.subtype || "");
    }
    } finally {
      // Signal SDK to clean up (terminate subprocess, close MCP connections)
      try { await iterator.return?.(); } catch { /* ignore cleanup errors */ }
      // Force-kill any remaining subprocess tree (safety net)
      if (signal) {
        // Small delay to let iterator.return() attempt graceful shutdown first
        setTimeout(() => forceCleanupAgentProcesses(signal), 500);
      }
    }
  } catch (err) {
    // Don't report abort as an error
    if (signal?.aborted) {
      if (signal) forceCleanupAgentProcesses(signal);
      return;
    }
    // Also clean up on unexpected errors
    if (signal) forceCleanupAgentProcesses(signal);
    yield {
      type: "error",
      message: classifyAgentError(err),
    };
  }
}

function classifyAgentError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("enoent") || lower.includes("not found") || lower.includes("not recognized")) {
    return `Claude CLI not found. Make sure Claude Code CLI is installed and in PATH.\n\nOriginal: ${msg}`;
  }
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return `Rate limited by API. Please wait a moment and try again.\n\nOriginal: ${msg}`;
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    return `Request timed out. The agent took too long to respond.\n\nOriginal: ${msg}`;
  }
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("auth") || lower.includes("api key")) {
    return `Authentication failed. Check your Claude CLI auth (run 'claude' to re-authenticate).\n\nOriginal: ${msg}`;
  }
  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("econnreset") || lower.includes("fetch failed")) {
    return `Network error. Check your internet connection.\n\nOriginal: ${msg}`;
  }
  if (lower.includes("overloaded") || lower.includes("503") || lower.includes("529")) {
    return `API is overloaded. Please try again in a few seconds.\n\nOriginal: ${msg}`;
  }

  return msg;
}
