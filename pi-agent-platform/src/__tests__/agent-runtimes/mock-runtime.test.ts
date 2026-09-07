import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, readFile, stat } from "fs/promises";
import { resolve } from "path";
import { MockRuntime, parsePiJsonlOutput } from "../../agent-runtimes/MockRuntime.js";
import type { AgentRunInput } from "../../agent-runtimes/AgentRuntime.js";

describe("MockRuntime", () => {
  const testDir = resolve(process.cwd(), "test-mock-runtime-tmp");
  const taskId = "TASK-MOCK-001";

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const stages = [
    "normalize_requirements",
    "analyze_requirements",
    "codegraph_impact",
    "write_implementation_plan",
    "write_tests",
    "implement_code",
    "fix_test_failures",
    "review_diff",
    "publish_final_report",
  ];

  for (const stage of stages) {
    it(`succeeds for stage ${stage}`, async () => {
      const runtime = new MockRuntime();
      const input: AgentRunInput = {
        taskId,
        stage,
        cwd: testDir,
        prompt: "test",
        sandbox: "read-only",
        tools: ["read_file", "write_artifact"],
      };
      const result = await runtime.run(input);
      expect(result.status).toBe("succeeded");
      expect(result.summary).toContain(stage);
    });
  }

  it("returns failed for unknown stage", async () => {
    const runtime = new MockRuntime();
    const input: AgentRunInput = {
      taskId,
      stage: "unknown_stage",
      cwd: testDir,
      prompt: "test",
      sandbox: "read-only",
      tools: [],
    };
    const result = await runtime.run(input);
    expect(result.status).toBe("failed");
    expect(result.error?.type).toBe("mock_not_configured");
  });

  it("writes output files for normalize_requirements", async () => {
    const runtime = new MockRuntime();
    const input: AgentRunInput = {
      taskId,
      stage: "normalize_requirements",
      cwd: testDir,
      prompt: "test",
      sandbox: "read-only",
      tools: ["read_file", "write_artifact"],
    };
    await runtime.run(input);
    const reqJson = await readFile(resolve(testDir, `artifacts/tasks/${taskId}/requirements.json`), "utf-8");
    const reqMd = await readFile(resolve(testDir, `artifacts/tasks/${taskId}/requirements.md`), "utf-8");
    const parsed = JSON.parse(reqJson);
    expect(parsed.background).toBeDefined();
    expect(parsed.goals).toBeDefined();
    expect(reqMd).toContain("# Requirements");
  });

  it("writes schema-valid JSON for codegraph_impact", async () => {
    const runtime = new MockRuntime();
    const input: AgentRunInput = {
      taskId,
      stage: "codegraph_impact",
      cwd: testDir,
      prompt: "test",
      sandbox: "read-only",
      tools: ["read_file", "write_artifact"],
    };
    await runtime.run(input);
    const raw = await readFile(resolve(testDir, `artifacts/tasks/${taskId}/codegraph-impact.json`), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.entrypoints).toBeDefined();
    expect(parsed.risks).toBeDefined();
    expect(parsed.risks[0].level).toBe("low");
  });

  it("writes schema-valid JSON for publish_final_report", async () => {
    const runtime = new MockRuntime();
    const input: AgentRunInput = {
      taskId,
      stage: "publish_final_report",
      cwd: testDir,
      prompt: "test",
      sandbox: "read-only",
      tools: ["read_file", "write_artifact"],
    };
    await runtime.run(input);
    const raw = await readFile(resolve(testDir, `artifacts/tasks/${taskId}/final-report.json`), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.task_id).toBe(taskId);
    expect(parsed.status).toBe("completed");
    expect(parsed.changed_files).toBeDefined();
  });
});

describe("parsePiJsonlOutput", () => {
  it("parses assistant text from message_update events", () => {
    const stdout = [
      JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } }),
      JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } }),
      JSON.stringify({ type: "turn_end" }),
    ].join("\n");

    const result = parsePiJsonlOutput(stdout);
    expect(result.assistantText).toBe("Hello world");
    expect(result.hasAssistantResponse).toBe(true);
    expect(result.turnCount).toBe(1);
  });

  it("detects tool errors", () => {
    const stdout = JSON.stringify({
      type: "tool_execution_end",
      isError: true,
      result: { content: [{ text: "error message" }] },
    });

    const result = parsePiJsonlOutput(stdout);
    expect(result.toolErrors).toContain("error message");
  });

  it("extracts usage from message_end", () => {
    const stdout = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    });

    const result = parsePiJsonlOutput(stdout);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });
});

describe("MockRuntime with PI_AGENT_MODE=mock", () => {
  const testDir = resolve(process.cwd(), "test-mock-env-tmp");

  beforeAll(async () => {
    process.env.PI_AGENT_MODE = "mock";
  });

  afterAll(async () => {
    delete process.env.PI_AGENT_MODE;
    await rm(testDir, { recursive: true, force: true });
  });

  it("uses mock outputs when PI_AGENT_MODE=mock", async () => {
    await mkdir(testDir, { recursive: true });
    const runtime = new MockRuntime();
    const input: AgentRunInput = {
      taskId: "TASK-ENV-001",
      stage: "normalize_requirements",
      cwd: testDir,
      prompt: "test",
      sandbox: "read-only",
      tools: ["read_file", "write_artifact"],
    };
    const result = await runtime.run(input);
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("Mock outputs");
  });
});
