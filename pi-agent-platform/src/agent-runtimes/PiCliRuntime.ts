import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import { openSync, closeSync, writeFileSync, writeSync } from "fs";
import { resolve, dirname } from "path";
import type { AgentRuntime, AgentRunInput, AgentRunResult } from "./AgentRuntime.js";

const FALLBACK_SANDBOX_TOOLS_MAP: Record<string, string[]> = {
  "read-only": ["read", "grep", "find", "ls"],
  "workspace-write": ["read", "grep", "find", "ls", "edit", "write", "bash"],
  "full-access": ["read", "grep", "find", "ls", "edit", "write", "bash"],
};

const PLATFORM_TO_PI_TOOL_MAP: Record<string, string[]> = {
  read_file: ["read"],
  write_file: ["write"],
  write_artifact: ["write"],
  patch: ["edit"],
  terminal: ["bash"],
  codegraph_context: ["bash"],
  codegraph_explore: ["bash"],
  codegraph_impact: ["bash"],
  list_files: ["ls", "find"],
};

function resolvePiTools(input: AgentRunInput): string[] {
  const declaredTools = input.tools.length > 0
    ? input.tools
    : FALLBACK_SANDBOX_TOOLS_MAP[input.sandbox] ?? FALLBACK_SANDBOX_TOOLS_MAP["read-only"];
  const resolved = declaredTools.flatMap((tool) => PLATFORM_TO_PI_TOOL_MAP[tool] ?? [tool]);
  return [...new Set(resolved)];
}

interface PiEvent {
  type: string;
  message?: { role?: string; content?: any };
  tool?: string;
  toolName?: string;
  toolInput?: Record<string, any>;
  toolOutput?: any;
  result?: any;
  isError?: boolean;
  turn?: number;
}

/**
 * Parse a single JSONL line and return a human-readable progress message.
 * Designed to be readable by a dashboard / operator.
 */
function formatEvent(evt: PiEvent): string | null {
  switch (evt.type) {
    case "turn_start":
      return `[🔄 Turn ${evt.turn ?? "?"}] Starting`;
    case "turn_end":
      return `[✅ Turn ${evt.turn ?? "?"}] Completed`;
    case "message_start": {
      const role = evt.message?.role ?? "unknown";
      return `[📨 Message start] role=${role}`;
    }
    case "message_end": {
      const role = evt.message?.role ?? "unknown";
      if (role === "assistant") {
        return `[🤖 Assistant response ended]`;
      }
      return `[📨 Message end] role=${role}`;
    }
    case "tool_execution_start": {
      const tool = evt.toolName || evt.tool || "?";
      return `[🔧 Tool call START] ${tool} — ${JSON.stringify(evt.toolInput ?? {}).slice(0, 120)}`;
    }
    case "tool_execution_end": {
      const tool = evt.toolName || evt.tool || "?";
      const status = evt.isError ? "❌ ERROR" : "✅ OK";
      const out = evt.toolOutput ?? evt.result;
      const preview = typeof out === "string" ? out.slice(0, 100)
        : out?.content?.[0]?.text ? String(out.content[0].text).slice(0, 100)
        : JSON.stringify(out).slice(0, 100);
      return `[🔧 Tool call END] ${tool} ${status} → ${preview}`;
    }
    case "usage":
      return `[📊 Usage] tokens=${JSON.stringify(evt)}`;
    default:
      return null; // skip noisy/internal events
  }
}

function shouldWriteCompactEvent(evt: PiEvent): boolean {
  return evt.type !== "message_update";
}

function shouldKeepRawJsonl(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PI_AGENT_KEEP_RAW_JSONL ?? "");
}

export class PiCliRuntime implements AgentRuntime {
  private piBin: string;

  constructor(piBin?: string) {
    this.piBin = piBin ?? "pi";
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const piTools = resolvePiTools(input);
    const toolsFlag = piTools.join(",");

    const artifactRoot = input.artifactRoot ?? resolve(input.cwd || process.cwd(), `artifacts/tasks/${input.taskId}`);
    const eventLog = resolve(artifactRoot, `${input.stage}.events.jsonl`);
    const stdoutLog = resolve(artifactRoot, `${input.stage}.stdout.jsonl`);
    const stderrLog = resolve(artifactRoot, `${input.stage}.stderr.log`);
    const promptFile = resolve(artifactRoot, `${input.stage}.prompt.txt`);
    const progressLog = resolve(artifactRoot, `${input.stage}.progress.log`);
    const keepRawJsonl = shouldKeepRawJsonl();

    console.log(`[PiCliRuntime] === Starting Pi for task=${input.taskId} stage=${input.stage} ===`);
    console.log(`[PiCliRuntime] cwd=${input.cwd || process.cwd()}`);
    console.log(`[PiCliRuntime] piBin=${this.piBin}`);
    console.log(`[PiCliRuntime] tools=${toolsFlag}`);
    console.log(`[PiCliRuntime] promptFile=${promptFile}`);
    console.log(`[PiCliRuntime] eventLog=${eventLog}`);
    console.log(`[PiCliRuntime] stdoutLog=${keepRawJsonl ? stdoutLog : "disabled; set PI_AGENT_KEEP_RAW_JSONL=1 to enable"}`);
    console.log(`[PiCliRuntime] stderrLog=${stderrLog}`);
    console.log(`[PiCliRuntime] progressLog=${progressLog}`);

    try {
      await mkdir(dirname(eventLog), { recursive: true });

      // Write prompt to temp file
      const { writeFile } = await import("fs/promises");
      await writeFile(promptFile, input.prompt, "utf-8");
      console.log(`[PiCliRuntime] Wrote prompt file (${input.prompt.length} bytes)`);

      // Use 'script' to fake a TTY — forces Node.js/Pi to flush stdout immediately
      // script -q -c "command" /dev/null  → no typescript file, just passes through with TTY
      const modelFlag = input.model ? ` --model '${input.model}'` : "";
      const providerFlag = input.provider ? ` --provider '${input.provider}'` : "";
      const shellCmd = `script -q -c "${this.piBin} --mode json --print --no-session${modelFlag}${providerFlag} --tools '${toolsFlag}' @${promptFile}" /dev/null`;

      console.log(`[PiCliRuntime] Launching: ${shellCmd.slice(0, 150)}...`);

      const child = spawn(shellCmd, [], {
        cwd: input.cwd || process.cwd(),
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PI_JSON_PRETTY: "false" },
      });

      // Open progress log for dashboard consumption
      const progressStream = openSync(progressLog, "w");
      const progressWrite = (msg: string) => {
        const line = `[${new Date().toISOString()}] ${msg}\n`;
        process.stdout.write(line);
        writeFileSync(progressStream, line);
      };

      progressWrite(`[PiCliRuntime] Pi process started (pid=${child.pid})`);

      // Stream stdout -> compact event log + optional raw JSONL + real-time progress.
      const eventFd = openSync(eventLog, "w");
      const stdoutFd = keepRawJsonl ? openSync(stdoutLog, "w") : undefined;
      const stderrFd = openSync(stderrLog, "w");
      let rawBuffer = "";
      let rawEventCount = 0;
      const compactEvents: PiEvent[] = [];
      let logsClosed = false;

      const closeLogs = () => {
        if (logsClosed) return;
        logsClosed = true;
        closeSync(eventFd);
        if (stdoutFd !== undefined) {
          closeSync(stdoutFd);
        }
        closeSync(stderrFd);
        closeSync(progressStream);
      };

      const processJsonlLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const evt: PiEvent = JSON.parse(trimmed);
          rawEventCount++;
          if (shouldWriteCompactEvent(evt)) {
            compactEvents.push(evt);
            writeSync(eventFd, JSON.stringify(evt) + "\n");
          }
          const msg = formatEvent(evt);
          if (msg) {
            progressWrite(msg);
          }
        } catch {
          // Skip non-JSON (TTY artifacts from script)
        }
      };

      child.stdout!.on("data", (chunk: Buffer) => {
        if (stdoutFd !== undefined) {
          writeSync(stdoutFd, chunk);
        }

        // Parse JSONL for progress
        rawBuffer += chunk.toString("utf-8");
        const lines = rawBuffer.split("\n");
        rawBuffer = lines.pop() || ""; // keep incomplete line

        for (const line of lines) {
          processJsonlLine(line);
        }
      });

      child.stderr!.on("data", (chunk: Buffer) => {
        writeSync(stderrFd, chunk);
        const text = chunk.toString("utf-8").trim();
        if (text) {
          progressWrite(`[stderr] ${text.slice(0, 200)}`);
        }
      });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on("error", (err) => {
          progressWrite(`[PiCliRuntime] Spawn error: ${err.message}`);
          closeLogs();
          reject(err);
        });
        child.on("close", (code) => {
          processJsonlLine(rawBuffer);
          rawBuffer = "";
          progressWrite(`[PiCliRuntime] Pi process exited with code=${code}`);
          closeLogs();
          resolve(code);
        });
      });

      const startTime = new Date();
      console.log(`[PiCliRuntime] Waiting for Pi to complete...`);

      if (exitCode === null || exitCode === undefined) {
        return {
          status: "failed",
          summary: "Pi process was killed (likely timed out or received a signal)",
          logFile: stderrLog,
          error: {
            type: "agent_killed",
            message: "Process killed by signal",
            retryable: true,
          },
        };
      }

      if (exitCode !== 0) {
        return {
          status: "failed",
          summary: `Pi exited with code ${exitCode}`,
          logFile: stderrLog,
          error: {
            type: "agent_exit_error",
            message: `Pi exited with code ${exitCode}`,
            retryable: true,
          },
        };
      }

      let turnCount = 0;
      let toolErrors: string[] = [];
      let hasAssistantResponse = false;
      let usage = { inputTokens: 0, outputTokens: 0 };

      for (const evt of compactEvents) {
        if (evt.type === "tool_execution_end" && evt.isError) {
          const result = evt.result ?? evt.toolOutput;
          toolErrors.push(result?.content?.[0]?.text || JSON.stringify(result));
        }
        if (evt.type === "turn_end") turnCount++;
        if (evt.type === "message_end" && evt.message?.role === "assistant") {
          hasAssistantResponse = true;
          const msgUsage = (evt.message as any)?.usage;
          if (msgUsage) {
            usage.inputTokens += Number(msgUsage.inputTokens ?? msgUsage.input_tokens ?? 0);
            usage.outputTokens += Number(msgUsage.outputTokens ?? msgUsage.output_tokens ?? 0);
          }
        }
        // Also handle standalone usage events (pi --mode json may emit them)
        if (evt.type === "usage") {
          const u = evt as any;
          usage.inputTokens += Number(u.inputTokens ?? u.input_tokens ?? 0);
          usage.outputTokens += Number(u.outputTokens ?? u.output_tokens ?? 0);
        }
      }

      console.log(`[PiCliRuntime] Final parse — rawEvents=${rawEventCount}, loggedEvents=${compactEvents.length}, turns=${turnCount}, errors=${toolErrors.length}, hasResponse=${hasAssistantResponse}`);

      if (toolErrors.length > 0) {
        return {
          status: "failed",
          summary: `Pi encountered ${toolErrors.length} tool error(s)`,
          logFile: stderrLog,
          error: {
            type: "tool_execution_error",
            message: toolErrors.join("\n"),
            retryable: true,
          },
        };
      }

      if (!hasAssistantResponse && turnCount === 0) {
        return {
          status: "failed",
          summary: "Pi produced no assistant response",
          logFile: stderrLog,
          error: {
            type: "invalid_agent_output",
            message: "No assistant messages found in JSONL output",
            retryable: false,
          },
        };
      }

      return {
        status: "succeeded",
        summary: `Pi completed (${turnCount} turn(s), ${compactEvents.length} logged event(s), ${rawEventCount} raw event(s))`,
        logFile: stderrLog,
        usage,
      };
    } catch (err: any) {
      console.error(`[PiCliRuntime] Unexpected error: ${err.message}`);
      return {
        status: "failed",
        summary: `Pi execution failed: ${err.message}`,
        logFile: stderrLog,
        error: {
          type: "agent_execution_error",
          message: err.message,
          retryable: err.code === "ENOENT" ? false : true,
        },
      };
    }
  }
}
