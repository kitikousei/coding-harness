import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdir, readFile, rm } from "fs/promises";
import { resolve } from "path";
import { PiAgentRuntime } from "../../agent-runtimes/PiAgentRuntime.js";
import type { AgentRunInput } from "../../agent-runtimes/AgentRuntime.js";

const sdk = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  DefaultResourceLoader: vi.fn(),
  defineTool: vi.fn((tool: any) => tool),
  getAgentDir: vi.fn(() => "/tmp/pi-agent-home"),
  sessionManagerInMemory: vi.fn((cwd: string) => ({ kind: "in-memory-session", cwd })),
}));

const processRunner = vi.hoisted(() => ({
  execa: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: sdk.createAgentSession,
  DefaultResourceLoader: sdk.DefaultResourceLoader,
  defineTool: sdk.defineTool,
  getAgentDir: sdk.getAgentDir,
  SessionManager: {
    inMemory: sdk.sessionManagerInMemory,
  },
}));

vi.mock("execa", () => ({
  execa: processRunner.execa,
}));

describe("PiAgentRuntime", () => {
  const testDir = resolve(process.cwd(), "test-pi-sdk-runtime-tmp");
  const taskId = "TASK-PI-SDK-001";
  let promptEvents: any[] = [];
  let lastSession: {
    subscribe: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };

  const input: AgentRunInput = {
    taskId,
    stage: "normalize_requirements",
    cwd: testDir,
    prompt: "Analyze requirements.",
    sandbox: "read-only",
    tools: ["read_file", "write_artifact"],
    allowedOutputPaths: [
      resolve(testDir, `artifacts/tasks/${taskId}/requirements.md`),
    ],
    timeoutMs: 300_000,
    maxToolCallsPerRun: 20,
  };

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });
    vi.clearAllMocks();
    processRunner.execa.mockResolvedValue({
      stdout: "CodeGraph output",
      stderr: "",
      exitCode: 0,
      failed: false,
      command: "codegraph",
    });
    promptEvents = [
      { type: "message_end", message: { role: "assistant", usage: { inputTokens: 12, outputTokens: 8 } } },
      { type: "turn_end" },
      { type: "agent_settled" },
    ];

    sdk.DefaultResourceLoader.mockImplementation(function ResourceLoaderMock(this: any, options: any) {
      this.options = options;
      this.reload = vi.fn().mockResolvedValue(undefined);
    });

    sdk.createAgentSession.mockImplementation(async () => {
      const listeners: Array<(event: any) => void> = [];
      lastSession = {
        subscribe: vi.fn((listener: (event: any) => void) => {
          listeners.push(listener);
          return vi.fn();
        }),
        prompt: vi.fn(async () => {
          for (const event of promptEvents) {
            for (const listener of listeners) {
              listener(event);
            }
          }
        }),
        dispose: vi.fn(),
      };
      return {
        session: lastSession,
        extensionsResult: { extensions: [], errors: [], runtime: {} },
      };
    });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates an SDK session with an explicit custom-agent resource loader and in-memory session", async () => {
    const runtime = new PiAgentRuntime();
    const result = await runtime.run(input);

    expect(result.status).toBe("succeeded");
    expect(sdk.getAgentDir).toHaveBeenCalled();
    expect(sdk.sessionManagerInMemory).toHaveBeenCalledWith(testDir);
    expect(sdk.DefaultResourceLoader).toHaveBeenCalledWith(expect.objectContaining({
      cwd: testDir,
      agentDir: "/tmp/pi-agent-home",
      noContextFiles: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    }));

    const loader = sdk.DefaultResourceLoader.mock.instances[0] as any;
    expect(loader.reload).toHaveBeenCalled();

    const loaderOptions = sdk.DefaultResourceLoader.mock.calls[0][0] as any;
    expect(loaderOptions.systemPromptOverride()).toContain("software engineering task agent");
    expect(loaderOptions.appendSystemPromptOverride(["old"])).toEqual([]);

    const sessionOptions = sdk.createAgentSession.mock.calls[0][0] as any;
    expect(sessionOptions.cwd).toBe(testDir);
    expect(sessionOptions.resourceLoader).toBe(loader);
    expect(sessionOptions.sessionManager).toEqual({ kind: "in-memory-session", cwd: testDir });
    expect(sessionOptions.tools).toEqual(["read", "write_artifact"]);
    expect(sessionOptions.customTools.map((tool: any) => tool.name)).toContain("write_artifact");
    expect(lastSession.dispose).toHaveBeenCalled();
  });

  it("lets read-only stages write only declared artifact output paths", async () => {
    const runtime = new PiAgentRuntime();
    await runtime.run(input);

    const sessionOptions = sdk.createAgentSession.mock.calls[0][0] as any;
    const artifactTool = sessionOptions.customTools.find((tool: any) => tool.name === "write_artifact");
    const allowedPath = resolve(testDir, `artifacts/tasks/${taskId}/requirements.md`);
    const deniedPath = resolve(testDir, "src/should-not-change.ts");

    await expect(artifactTool.execute("tool-1", {
      path: allowedPath,
      content: "# Requirements\n\nAllowed artifact write.",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("Wrote artifact") }],
      details: { path: allowedPath, bytes: 39 },
    });

    await expect(readFile(allowedPath, "utf-8")).resolves.toBe("# Requirements\n\nAllowed artifact write.");
    await expect(artifactTool.execute("tool-2", {
      path: deniedPath,
      content: "export const leaked = true;",
    })).rejects.toThrow("is not an allowed artifact output");
  });

  it("registers CodeGraph MCP tools as SDK custom tools", async () => {
    const runtime = new PiAgentRuntime();
    const result = await runtime.run({
      ...input,
      tools: ["read_file", "write_artifact", "codegraph_context", "codegraph_explore", "codegraph_impact"],
      mcpServers: [{ id: "codegraph-mcp", command: "codegraph", args: ["serve", "--mcp"] }],
    });

    expect(result.status).toBe("succeeded");

    const sessionOptions = sdk.createAgentSession.mock.calls[0][0] as any;
    expect(sessionOptions.tools).toEqual([
      "read",
      "write_artifact",
      "codegraph_context",
      "codegraph_explore",
      "codegraph_impact",
    ]);
    expect(sessionOptions.customTools.map((tool: any) => tool.name)).toEqual([
      "write_artifact",
      "codegraph_context",
      "codegraph_explore",
      "codegraph_impact",
    ]);

    const contextTool = sessionOptions.customTools.find((tool: any) => tool.name === "codegraph_context");
    await expect(contextTool.execute("tool-codegraph-context", {
      query: "runStage flow",
      maxNodes: 5,
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "CodeGraph output" }],
      details: { command: "codegraph context", exitCode: 0 },
    });

    expect(processRunner.execa).toHaveBeenCalledWith("codegraph", [
      "context",
      "--path",
      testDir,
      "--max-nodes",
      "5",
      "runStage flow",
    ], expect.objectContaining({
      cwd: testDir,
      reject: false,
    }));
  });

  it("fails when subscribed tool execution errors occur", async () => {
    promptEvents = [
      { type: "tool_execution_end", toolCallId: "1", toolName: "read", isError: true, result: { content: [{ type: "text", text: "Permission denied" }] } },
      { type: "message_end", message: { role: "assistant" } },
      { type: "turn_end" },
      { type: "agent_settled" },
    ];

    const runtime = new PiAgentRuntime();
    const result = await runtime.run(input);

    expect(result.status).toBe("failed");
    expect(result.error?.type).toBe("tool_execution_error");
    expect(result.error?.message).toContain("Permission denied");
  });

  it("omits streaming message updates from SDK event logs", async () => {
    promptEvents = [
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "D" } },
      { type: "message_update", assistantMessageEvent: { type: "toolcall_delta", partial: { content: [{ type: "tool_call", name: "read" }] } } },
      { type: "tool_execution_start", toolName: "read" },
      { type: "tool_execution_end", toolName: "read", isError: false, result: { content: [{ type: "text", text: "ok" }] } },
      { type: "message_end", message: { role: "assistant" } },
      { type: "turn_end" },
      { type: "agent_settled" },
    ];

    const runtime = new PiAgentRuntime();
    const result = await runtime.run(input);

    expect(result.status).toBe("succeeded");
    const logPath = resolve(testDir, `artifacts/tasks/${taskId}/normalize_requirements.events.jsonl`);
    const log = await readEventually(logPath);
    const loggedTypes = log.trim().split("\n").map((line) => JSON.parse(line).type);

    expect(loggedTypes).toEqual([
      "tool_execution_start",
      "tool_execution_end",
      "message_end",
      "turn_end",
      "agent_settled",
    ]);
    expect(log).not.toContain("message_update");
  });
});

async function readEventually(path: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await readFile(path, "utf-8");
    } catch (err) {
      lastError = err;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
  throw lastError;
}
