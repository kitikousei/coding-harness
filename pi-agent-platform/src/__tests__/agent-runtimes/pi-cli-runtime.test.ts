import { EventEmitter } from "events";
import { access, readFile, rm } from "fs/promises";
import { resolve } from "path";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { PiCliRuntime } from "../../agent-runtimes/PiCliRuntime.js";
import type { AgentRunInput } from "../../agent-runtimes/AgentRuntime.js";

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: childProcess.spawn,
}));

describe("PiCliRuntime", () => {
  const testDir = resolve(process.cwd(), "test-pi-cli-runtime-tmp");
  const input: AgentRunInput = {
    taskId: "TASK-PI-001",
    stage: "normalize_requirements",
    cwd: testDir,
    prompt: "Analyze requirements.",
    sandbox: "read-only",
    tools: ["read", "grep", "find", "ls"],
  };

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function jsonlEvents(events: any[]): string {
    return events.map(e => JSON.stringify(e)).join("\n");
  }

  function mockPiProcess(options: { stdout?: string; stderr?: string; exitCode?: number; error?: Error }) {
    childProcess.spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 12345;

      queueMicrotask(() => {
        if (options.error) {
          child.emit("error", options.error);
          return;
        }

        if (options.stdout) child.stdout.emit("data", Buffer.from(options.stdout));
        if (options.stderr) child.stderr.emit("data", Buffer.from(options.stderr));
        child.emit("close", options.exitCode ?? 0);
      });

      return child;
    });
  }

  it("writes compact events by default without raw message update deltas", async () => {
    mockPiProcess({
      stdout: jsonlEvents([
        { type: "session", version: 3 },
        { type: "agent_start" },
        { type: "turn_start" },
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "D" } },
        { type: "message_update", assistantMessageEvent: { type: "toolcall_delta", partial: { content: [{ type: "tool_call", name: "read", arguments: { path: "/tmp/a" } }] } } },
        { type: "tool_execution_start", toolName: "read" },
        { type: "tool_execution_end", toolName: "read", isError: false, result: { content: [{ type: "text", text: "ok" }] } },
        { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
        { type: "turn_end" },
        { type: "agent_settled" },
      ]),
    });

    const runtime = new PiCliRuntime();
    const result = await runtime.run(input);

    expect(result.status).toBe("succeeded");
    const compactLog = resolve(testDir, "artifacts/tasks/TASK-PI-001/normalize_requirements.events.jsonl");
    const rawLog = resolve(testDir, "artifacts/tasks/TASK-PI-001/normalize_requirements.stdout.jsonl");
    const lines = (await readFile(compactLog, "utf-8")).trim().split("\n");
    const loggedTypes = lines.map((line) => JSON.parse(line).type);

    expect(loggedTypes).toEqual([
      "session",
      "agent_start",
      "turn_start",
      "tool_execution_start",
      "tool_execution_end",
      "message_end",
      "turn_end",
      "agent_settled",
    ]);
    expect(lines.join("\n")).not.toContain("message_update");
    await expect(access(rawLog)).rejects.toThrow();
  });

  it("keeps raw JSONL only when explicitly requested", async () => {
    const previous = process.env.PI_AGENT_KEEP_RAW_JSONL;
    process.env.PI_AGENT_KEEP_RAW_JSONL = "1";
    try {
      mockPiProcess({
        stdout: jsonlEvents([
          { type: "session", version: 3 },
          { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "D" } },
          { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
          { type: "turn_end" },
        ]),
      });

      const runtime = new PiCliRuntime();
      const result = await runtime.run(input);

      expect(result.status).toBe("succeeded");
      const compactLog = resolve(testDir, "artifacts/tasks/TASK-PI-001/normalize_requirements.events.jsonl");
      const rawLog = resolve(testDir, "artifacts/tasks/TASK-PI-001/normalize_requirements.stdout.jsonl");

      expect(await readFile(rawLog, "utf-8")).toContain("message_update");
      expect(await readFile(compactLog, "utf-8")).not.toContain("message_update");
    } finally {
      if (previous === undefined) {
        delete process.env.PI_AGENT_KEEP_RAW_JSONL;
      } else {
        process.env.PI_AGENT_KEEP_RAW_JSONL = previous;
      }
    }
  });

  it("returns succeeded when pi exits 0 with valid JSONL", async () => {
    mockPiProcess({
      stdout: jsonlEvents([
        { type: "session", version: 3 },
        { type: "agent_start" },
        { type: "turn_start" },
        { type: "message_start", message: { role: "user" } },
        { type: "message_end", message: { role: "user" } },
        { type: "message_start", message: { role: "assistant" } },
        { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
        { type: "turn_end" },
      ]),
    });

    const runtime = new PiCliRuntime();
    const result = await runtime.run(input);
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("1 turn");
  });

  it("returns succeeded for normal completion", async () => {
    mockPiProcess({
      stdout: jsonlEvents([
        { type: "session", version: 3 },
        { type: "agent_start" },
        { type: "turn_start" },
        { type: "message_start", message: { role: "assistant" } },
        { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
        { type: "turn_end" },
      ]),
    });

    const runtime = new PiCliRuntime();
    const result = await runtime.run({ ...input, prompt: "test" });
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("1 turn");
  });

  it("returns failed on non-zero exit code", async () => {
    mockPiProcess({
      stderr: "Error: something went wrong",
      exitCode: 1,
    });

    const runtime = new PiCliRuntime();
    const result = await runtime.run(input);
    expect(result.status).toBe("failed");
    expect(result.error?.type).toBe("agent_exit_error");
  });

  it("returns failed when pi is not installed", async () => {
    const err = new Error("command not found") as any;
    err.code = "ENOENT";
    mockPiProcess({ error: err });

    const runtime = new PiCliRuntime();
    const result = await runtime.run(input);
    expect(result.status).toBe("failed");
    expect(result.error?.retryable).toBe(false);
  });

  it("keeps artifact writes separate from Pi's general write tool", async () => {
    mockPiProcess({
      stdout: jsonlEvents([
        { type: "message_end", message: { role: "assistant" } },
        { type: "turn_end" },
      ]),
    });

    const runtime = new PiCliRuntime();
    await runtime.run({
      ...input,
      tools: ["read_file", "write_artifact", "codegraph_context", "codegraph_explore"],
    });

    const command = childProcess.spawn.mock.calls[0][0];
    expect(command).toContain("--tools 'read,codegraph_context,codegraph_explore'");
  });

  it("deduplicates translated workspace-write tools", async () => {
    mockPiProcess({
      stdout: jsonlEvents([
        { type: "message_end", message: { role: "assistant" } },
        { type: "turn_end" },
      ]),
    });

    const runtime = new PiCliRuntime();
    await runtime.run({
      ...input,
      sandbox: "workspace-write",
      tools: ["read_file", "write_file", "write_artifact", "patch", "terminal"],
    });

    const command = childProcess.spawn.mock.calls[0][0];
    expect(command).toContain("--tools 'read,write,edit,bash'");
  });

  it("returns failed when tool errors occur", async () => {
    mockPiProcess({
      stdout: jsonlEvents([
        { type: "tool_execution_end", toolCallId: "1", toolName: "read", isError: true, result: { content: [{ type: "text", text: "Permission denied" }] } },
        { type: "message_end", message: { role: "assistant" } },
        { type: "turn_end" },
      ]),
    });

    const runtime = new PiCliRuntime();
    const result = await runtime.run(input);
    expect(result.status).toBe("failed");
    expect(result.error?.type).toBe("tool_execution_error");
  });
});
