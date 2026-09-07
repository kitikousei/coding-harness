import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { runStage } from "../../stages/runStage.js";
import { FileBasedRegistry } from "../../capability/CapabilityRegistry.js";
import { DefaultStageEnforcer } from "../../capability/StageEnforcer.js";
import { DummyMCPServerManager } from "../../capability/MCPServerManager.js";
import { FileSkillLoader } from "../../capability/SkillLoader.js";
import { DefaultOutputValidator } from "../../capability/OutputValidator.js";
import { LocalArtifactStore } from "../../artifacts/LocalArtifactStore.js";
import { MockRuntime } from "../../agent-runtimes/MockRuntime.js";
import type { AgentRunInput } from "../../agent-runtimes/AgentRuntime.js";
import type { OutputValidator } from "../../capability/OutputValidator.js";
import { StageBlockedError } from "../../capability/errors.js";

describe("runStage", () => {
  const testDir = resolve(process.cwd(), "test-runstage-tmp");
  const taskId = "TASK-RUN-001";

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function makeDeps(outputValidator: OutputValidator = new DefaultOutputValidator()) {
    const artifactStore = new LocalArtifactStore(testDir);
    return {
      registry: new FileBasedRegistry(),
      enforcer: new DefaultStageEnforcer(),
      mcpManager: new DummyMCPServerManager(),
      skillLoader: new FileSkillLoader(),
      outputValidator,
      artifactStore,
    };
  }

  const passingOutputValidator: OutputValidator = {
    async validateOutputs() {
      return { valid: true };
    },
  };

  it("runs normalize_requirements with MockRuntime successfully", async () => {
    const deps = makeDeps();
    await deps.artifactStore.ensureTask(taskId);

    const result = await runStage({
      taskId,
      stage: "normalize_requirements",
      worktreePath: process.cwd(),
      artifactRoot: resolve(process.cwd(), `artifacts/tasks/${taskId}`),
      runtime: new MockRuntime(),
      approvedOperations: [],
    }, deps);

    expect(result.status).toBe("succeeded");
    expect(result.stage).toBe("normalize_requirements");

    // Verify events.jsonl
    const eventsRaw = await deps.artifactStore.readText(taskId, "events.jsonl");
    const events = eventsRaw.trim().split("\n").map(JSON.parse);
    expect(events.some((e: any) => e.event === "stage.started")).toBe(true);
    expect(events.some((e: any) => e.event === "stage.completed")).toBe(true);
  });

  it("records stage.started and stage.completed events", async () => {
    const deps = makeDeps();
    await deps.artifactStore.ensureTask(taskId + "-2");

    await runStage({
      taskId: taskId + "-2",
      stage: "normalize_requirements",
      worktreePath: process.cwd(),
      artifactRoot: resolve(process.cwd(), `artifacts/tasks/${taskId}-2`),
      runtime: new MockRuntime(),
      approvedOperations: [],
    }, deps);

    const eventsRaw = await deps.artifactStore.readText(taskId + "-2", "events.jsonl");
    const events = eventsRaw.trim().split("\n").map(JSON.parse);
    const eventTypes = events.map((e: any) => e.event);
    expect(eventTypes).toContain("stage.started");
    expect(eventTypes).toContain("stage.completed");
  });

  it("persists the assembled prompt used for the runtime", async () => {
    const deps = makeDeps(passingOutputValidator);
    const promptTaskId = taskId + "-prompt";
    await deps.artifactStore.ensureTask(promptTaskId);

    class CapturingRuntime {
      prompt = "";

      async run(input: AgentRunInput) {
        this.prompt = input.prompt;
        return {
          status: "succeeded" as const,
          summary: "captured prompt",
          outputArtifacts: [],
        };
      }
    }

    const runtime = new CapturingRuntime();
    await runStage({
      taskId: promptTaskId,
      stage: "normalize_requirements",
      worktreePath: process.cwd(),
      artifactRoot: resolve(process.cwd(), `artifacts/tasks/${promptTaskId}`),
      runtime,
      approvedOperations: [],
      context: { humanCorrection: "Keep existing public APIs unchanged." },
    }, deps);

    expect(await deps.artifactStore.exists(promptTaskId, "normalize_requirements.prompt.md")).toBe(true);
    const savedPrompt = await deps.artifactStore.readText(promptTaskId, "normalize_requirements.prompt.md");
    expect(savedPrompt).toBe(runtime.prompt);
    expect(savedPrompt).toContain("\"humanCorrection\": \"Keep existing public APIs unchanged.\"");
  });

  it("passes started MCP server runtime configs to the agent runtime", async () => {
    const startedMcpServers = [
      {
        id: "codegraph-mcp",
        command: "codegraph",
        args: ["serve", "--mcp"],
      },
    ];
    const deps = {
      ...makeDeps(passingOutputValidator),
      mcpManager: {
        async startServers() {
          return { started: startedMcpServers as any, warnings: [] };
        },
        async stopServers() {},
      },
    };
    const promptTaskId = taskId + "-mcp-config";
    await deps.artifactStore.ensureTask(promptTaskId);

    class CapturingRuntime {
      input?: AgentRunInput;

      async run(input: AgentRunInput) {
        this.input = input;
        return {
          status: "succeeded" as const,
          summary: "captured runtime input",
          outputArtifacts: [],
        };
      }
    }

    const runtime = new CapturingRuntime();
    await runStage({
      taskId: promptTaskId,
      stage: "normalize_requirements",
      worktreePath: process.cwd(),
      artifactRoot: resolve(process.cwd(), `artifacts/tasks/${promptTaskId}`),
      runtime,
      approvedOperations: [],
    }, deps);

    expect((runtime.input as any).mcpServers).toEqual(startedMcpServers);
  });

  it("continues when recoverable tool errors still produce valid stage outputs", async () => {
    const deps = makeDeps(passingOutputValidator);
    const recoverableTaskId = taskId + "-recoverable-tool-error";
    await deps.artifactStore.ensureTask(recoverableTaskId);

    class RecoverableToolErrorRuntime {
      async run() {
        return {
          status: "failed" as const,
          summary: "Pi encountered 1 tool error(s)",
          outputArtifacts: [],
          error: {
            type: "tool_execution_error",
            message: "ENOENT: no such file or directory",
            retryable: true,
          },
        };
      }
    }

    const result = await runStage({
      taskId: recoverableTaskId,
      stage: "analyze_requirements",
      worktreePath: process.cwd(),
      artifactRoot: resolve(process.cwd(), `artifacts/tasks/${recoverableTaskId}`),
      runtime: new RecoverableToolErrorRuntime(),
      approvedOperations: [],
    }, deps);

    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("required outputs validated");

    const eventsRaw = await deps.artifactStore.readText(recoverableTaskId, "events.jsonl");
    const events = eventsRaw.trim().split("\n").map(JSON.parse);
    expect(events.some((e: any) => e.event === "stage.warning" && e.summary.includes("tool error"))).toBe(true);
    expect(events.some((e: any) => e.event === "stage.completed")).toBe(true);
  });

  it("passes manifest output paths and runtime constraints to the agent runtime", async () => {
    const deps = makeDeps(passingOutputValidator);
    const constrainedTaskId = taskId + "-runtime-constraints";
    await deps.artifactStore.ensureTask(constrainedTaskId);

    class CapturingRuntime {
      input?: AgentRunInput;

      async run(input: AgentRunInput) {
        this.input = input;
        return {
          status: "succeeded" as const,
          summary: "captured runtime constraints",
          outputArtifacts: [],
        };
      }
    }

    const runtime = new CapturingRuntime();
    const artifactRoot = resolve(process.cwd(), `artifacts/tasks/${constrainedTaskId}`);

    await runStage({
      taskId: constrainedTaskId,
      stage: "normalize_requirements",
      worktreePath: process.cwd(),
      artifactRoot,
      runtime,
      approvedOperations: [],
    }, deps);

    expect(runtime.input?.artifactRoot).toBe(artifactRoot);
    expect(runtime.input?.allowedOutputPaths).toEqual([
      resolve(process.cwd(), `artifacts/tasks/${constrainedTaskId}/requirements.json`),
      resolve(process.cwd(), `artifacts/tasks/${constrainedTaskId}/requirements.md`),
    ]);
    expect(runtime.input?.timeoutMs).toBe(300_000);
    expect(runtime.input?.maxToolCallsPerRun).toBe(20);
  });

  it("returns blocked and records the event when required MCP startup is blocked", async () => {
    const deps = {
      ...makeDeps(passingOutputValidator),
      mcpManager: {
        async startServers() {
          throw new StageBlockedError("normalize_requirements", "Required MCP server 'codegraph-mcp' is not available");
        },
        async stopServers() {},
      },
    };
    const blockedTaskId = taskId + "-blocked-mcp";
    await deps.artifactStore.ensureTask(blockedTaskId);

    const result = await runStage({
      taskId: blockedTaskId,
      stage: "normalize_requirements",
      worktreePath: process.cwd(),
      artifactRoot: resolve(process.cwd(), `artifacts/tasks/${blockedTaskId}`),
      runtime: new MockRuntime(),
      approvedOperations: [],
    }, deps);

    expect(result.status).toBe("blocked");
    expect(result.error?.type).toBe("stage_blocked");

    const eventsRaw = await deps.artifactStore.readText(blockedTaskId, "events.jsonl");
    const events = eventsRaw.trim().split("\n").map(JSON.parse);
    expect(events.some((e: any) => e.event === "stage.blocked")).toBe(true);
  });
});
