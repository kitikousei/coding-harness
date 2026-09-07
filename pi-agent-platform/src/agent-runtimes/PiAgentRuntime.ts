import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  SessionManager,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execa } from "execa";
import { mkdir, writeFile } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import type { AgentRuntime, AgentRunInput, AgentRunResult } from "./AgentRuntime.js";

const DEFAULT_TIMEOUT_MS = 600_000;

const FALLBACK_SANDBOX_TOOLS_MAP: Record<string, string[]> = {
  "read-only": ["read", "grep", "find", "ls"],
  "workspace-write": ["read", "grep", "find", "ls", "edit", "write", "bash"],
  "full-access": ["read", "grep", "find", "ls", "edit", "write", "bash"],
};

const PLATFORM_TO_SDK_TOOL_MAP: Record<string, string[]> = {
  read_file: ["read"],
  write_file: ["write"],
  write_artifact: ["write_artifact"],
  patch: ["edit"],
  terminal: ["bash"],
};

const CODEGRAPH_SERVER_IDS = new Set(["codegraph", "codegraph-mcp"]);
const CODEGRAPH_TOOL_NAMES = ["codegraph_context", "codegraph_explore", "codegraph_impact"] as const;

interface RuntimeEventState {
  toolErrors: string[];
  turnCount: number;
  toolCallCount: number;
  hasAssistantResponse: boolean;
  agentSettled: boolean;
  toolLimitExceeded?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export class PiAgentRuntime implements AgentRuntime {
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const unsupportedMcpServers = (input.mcpServers ?? []).filter((server) => !CODEGRAPH_SERVER_IDS.has(server.id));
    if (unsupportedMcpServers.length > 0) {
      return {
        status: "failed",
        summary: "Pi SDK runtime does not support one or more MCP server configs yet",
        error: {
          type: "mcp_not_supported",
          message: `Unsupported MCP server(s): ${unsupportedMcpServers.map((server) => server.id).join(", ")}`,
          retryable: false,
        },
      };
    }

    const cwd = input.cwd || process.cwd();
    const artifactRoot = input.artifactRoot ?? resolve(cwd, `artifacts/tasks/${input.taskId}`);
    const eventLog = resolve(artifactRoot, `${input.stage}.events.jsonl`);
    const eventState: RuntimeEventState = {
      toolErrors: [],
      turnCount: 0,
      toolCallCount: 0,
      hasAssistantResponse: false,
      agentSettled: false,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    let eventWriteQueue = Promise.resolve();

    const enqueueRuntimeEvent = (event: AgentSessionEvent) => {
      if (!shouldAppendRuntimeEvent(event)) return;
      eventWriteQueue = eventWriteQueue.then(() => appendRuntimeEvent(eventLog, event));
    };

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      noContextFiles: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPromptOverride: () => buildSystemPrompt(input),
      appendSystemPromptOverride: () => [],
    });
    await resourceLoader.reload();

    const activeTools = resolveSdkTools(input);
    const customTools = createCustomTools(input, cwd);
    const { session } = await createAgentSession({
      cwd,
      tools: activeTools,
      customTools,
      resourceLoader,
      sessionManager: SessionManager.inMemory(cwd),
    });

    const unsubscribe = session.subscribe((event) => {
      updateEventState(eventState, event);
      enqueueRuntimeEvent(event);
      if (
        input.maxToolCallsPerRun !== undefined &&
        event.type === "tool_execution_start" &&
        eventState.toolCallCount > input.maxToolCallsPerRun &&
        !eventState.toolLimitExceeded
      ) {
        eventState.toolLimitExceeded = `Pi exceeded maxToolCallsPerRun=${input.maxToolCallsPerRun}`;
        void session.abort().catch(() => undefined);
      }
    });

    try {
      await withTimeout(session.prompt(input.prompt), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    } catch (err: any) {
      return {
        status: "failed",
        summary: `Pi SDK execution failed: ${err.message}`,
        logFile: eventLog,
        error: {
          type: eventState.toolLimitExceeded ? "tool_limit_exceeded" : "agent_execution_error",
          message: eventState.toolLimitExceeded ?? err.message,
          retryable: !eventState.toolLimitExceeded,
        },
      };
    } finally {
      unsubscribe();
      await eventWriteQueue;
      session.dispose();
    }

    if (eventState.toolLimitExceeded) {
      return {
        status: "failed",
        summary: eventState.toolLimitExceeded,
        logFile: eventLog,
        error: {
          type: "tool_limit_exceeded",
          message: eventState.toolLimitExceeded,
          retryable: false,
        },
      };
    }

    if (eventState.toolErrors.length > 0) {
      return {
        status: "failed",
        summary: `Pi encountered ${eventState.toolErrors.length} tool error(s)`,
        logFile: eventLog,
        error: {
          type: "tool_execution_error",
          message: eventState.toolErrors.join("\n"),
          retryable: true,
        },
      };
    }

    if (!eventState.hasAssistantResponse && eventState.turnCount === 0) {
      return {
        status: "failed",
        summary: "Pi produced no assistant response",
        logFile: eventLog,
        error: {
          type: "invalid_agent_output",
          message: "No assistant messages found in SDK event stream",
          retryable: false,
        },
      };
    }

    return {
      status: "succeeded",
      summary: eventState.agentSettled
        ? `Pi SDK completed (${eventState.turnCount} turn(s))`
        : `Pi SDK completed without agent_settled (${eventState.turnCount} turn(s))`,
      logFile: eventLog,
      usage: eventState.usage,
    };
  }
}

function resolveSdkTools(input: AgentRunInput): string[] {
  const declaredTools = input.tools.length > 0
    ? input.tools
    : FALLBACK_SANDBOX_TOOLS_MAP[input.sandbox] ?? FALLBACK_SANDBOX_TOOLS_MAP["read-only"];
  const resolved = declaredTools.flatMap((tool) => PLATFORM_TO_SDK_TOOL_MAP[tool] ?? [tool]);
  return [...new Set(resolved)];
}

function createCustomTools(input: AgentRunInput, cwd: string): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const activeTools = resolveSdkTools(input);
  if (activeTools.includes("write_artifact")) {
    tools.push(createWriteArtifactTool(cwd, input.allowedOutputPaths ?? []));
  }
  for (const toolName of CODEGRAPH_TOOL_NAMES) {
    if (activeTools.includes(toolName)) {
      tools.push(createCodeGraphTool(cwd, toolName));
    }
  }
  return tools;
}

function createWriteArtifactTool(cwd: string, allowedOutputPaths: string[]): ToolDefinition {
  const allowed = new Set(allowedOutputPaths.map((path) => resolve(path)));

  return defineTool({
    name: "write_artifact",
    label: "Write Artifact",
    description: "Write a required task artifact. Only declared artifact output paths are allowed.",
    promptSnippet: "write_artifact: write content to one declared task artifact output path.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute path or cwd-relative path of the declared artifact output." }),
      content: Type.String({ description: "Complete file content to write." }),
    }),
    async execute(_toolCallId, params) {
      const targetPath = resolveArtifactPath(cwd, params.path);
      if (!allowed.has(targetPath)) {
        throw new Error(`Path '${targetPath}' is not an allowed artifact output.`);
      }

      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, params.content, "utf-8");

      return {
        content: [{ type: "text", text: `Wrote artifact: ${targetPath}` }],
        details: {
          path: targetPath,
          bytes: Buffer.byteLength(params.content, "utf-8"),
        },
      };
    },
  });
}

function resolveArtifactPath(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function createCodeGraphTool(cwd: string, toolName: typeof CODEGRAPH_TOOL_NAMES[number]): ToolDefinition {
  if (toolName === "codegraph_context") {
    return defineTool({
      name: "codegraph_context",
      label: "CodeGraph Context",
      description: "Build focused CodeGraph context for a task using the local project index.",
      promptSnippet: "codegraph_context: build focused code context for a natural-language task.",
      parameters: Type.Object({
        query: Type.String({ description: "Natural-language task or area to gather context for." }),
        maxNodes: Type.Optional(Type.Number({ description: "Maximum number of symbols to include." })),
        includeCode: Type.Optional(Type.Boolean({ description: "Whether to include code blocks. Defaults to true." })),
      }),
      async execute(_toolCallId, params, signal) {
        const args = ["context", "--path", cwd];
        if (typeof params.maxNodes === "number") {
          args.push("--max-nodes", String(params.maxNodes));
        }
        if (params.includeCode === false) {
          args.push("--no-code");
        }
        args.push(params.query);
        return runCodeGraph(cwd, args, signal);
      },
    });
  }

  if (toolName === "codegraph_explore") {
    return defineTool({
      name: "codegraph_explore",
      label: "CodeGraph Explore",
      description: "Explore relevant symbols' source and call paths using the local CodeGraph index.",
      promptSnippet: "codegraph_explore: inspect relevant symbols, source, and call paths.",
      parameters: Type.Object({
        query: Type.String({ description: "Symbol names, file names, or natural-language area to explore." }),
        maxFiles: Type.Optional(Type.Number({ description: "Maximum number of files to include source from." })),
      }),
      async execute(_toolCallId, params, signal) {
        const args = ["explore", "--path", cwd];
        if (typeof params.maxFiles === "number") {
          args.push("--max-files", String(params.maxFiles));
        }
        args.push(params.query);
        return runCodeGraph(cwd, args, signal);
      },
    });
  }

  return defineTool({
    name: "codegraph_impact",
    label: "CodeGraph Impact",
    description: "Analyze code affected by changing a symbol using the local CodeGraph index.",
    promptSnippet: "codegraph_impact: analyze what would be affected by changing a symbol.",
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol name to analyze." }),
      depth: Type.Optional(Type.Number({ description: "Traversal depth. Defaults to CodeGraph CLI default." })),
      json: Type.Optional(Type.Boolean({ description: "Return CodeGraph JSON output when true." })),
    }),
    async execute(_toolCallId, params, signal) {
      const args = ["impact", "--path", cwd];
      if (typeof params.depth === "number") {
        args.push("--depth", String(params.depth));
      }
      if (params.json === true) {
        args.push("--json");
      }
      args.push(params.symbol);
      return runCodeGraph(cwd, args, signal);
    },
  });
}

async function runCodeGraph(cwd: string, args: string[], signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("CodeGraph command aborted before start.");
  }

  const result = await execa("codegraph", args, {
    cwd,
    reject: false,
    timeout: 60_000,
  });
  const command = `codegraph ${args[0]}`;

  if (result.exitCode !== 0) {
    throw new Error(`${command} failed with code ${result.exitCode}: ${result.stderr || result.stdout}`);
  }

  return {
    content: [{ type: "text" as const, text: result.stdout || result.stderr || "" }],
    details: {
      command,
      args,
      exitCode: result.exitCode,
      stderr: result.stderr,
    },
  };
}

function buildSystemPrompt(input: AgentRunInput): string {
  return [
    "You are a software engineering task agent running inside pi-agent-platform.",
    "Execute exactly one declared stage per prompt and follow the Platform Contract in the user message.",
    "Use only active tools. In read-only stages, never modify repository source files.",
    "Use write_artifact for declared task artifacts; do not use general file writes for artifacts.",
    `Current stage: ${input.stage}.`,
  ].join("\n");
}

function updateEventState(state: RuntimeEventState, event: AgentSessionEvent) {
  if (event.type === "tool_execution_start") {
    state.toolCallCount++;
  }

  if (event.type === "tool_execution_end" && event.isError) {
    state.toolErrors.push(extractToolError(event.result));
  }

  if (event.type === "turn_end") {
    state.turnCount++;
  }

  if (event.type === "message_end" && event.message?.role === "assistant") {
    state.hasAssistantResponse = true;
    const usage = (event.message as any).usage;
    if (usage) {
      state.usage.inputTokens += Number(usage.inputTokens ?? usage.input_tokens ?? 0);
      state.usage.outputTokens += Number(usage.outputTokens ?? usage.output_tokens ?? 0);
    }
  }

  if (event.type === "agent_settled") {
    state.agentSettled = true;
  }
}

function extractToolError(result: unknown): string {
  const maybeContent = (result as any)?.content;
  const firstText = Array.isArray(maybeContent) ? maybeContent[0]?.text : undefined;
  return firstText || JSON.stringify(result);
}

async function appendRuntimeEvent(path: string, event: AgentSessionEvent) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(event) + "\n", { encoding: "utf-8", flag: "a" });
  } catch {
    // Event logging must not fail the agent run.
  }
}

function shouldAppendRuntimeEvent(event: AgentSessionEvent): boolean {
  return event.type !== "message_update";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Pi SDK run exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
