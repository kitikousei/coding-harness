import { describe, it, expect, vi } from "vitest";
import { CodexRuntime } from "../../agent-runtimes/CodexRuntime.js";
import type { AgentRunInput } from "../../agent-runtimes/AgentRuntime.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

describe("CodexRuntime", () => {
  const input: AgentRunInput = {
    taskId: "TASK-CODEX-001",
    stage: "codegraph_impact",
    cwd: "/tmp/test",
    prompt: "Analyze CodeGraph impact.",
    sandbox: "read-only",
    tools: ["read_file", "write_artifact", "codegraph_context"],
    mcpServers: [
      {
        id: "codegraph-mcp",
        command: "codegraph",
        args: ["serve", "--mcp"],
      },
    ],
  };

  it("passes started MCP servers to codex config overrides", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify({ status: "succeeded", summary: "done" }),
      stderr: "",
      exitCode: 0,
      failed: false,
      command: "codex",
    } as any);

    const runtime = new CodexRuntime();
    await runtime.run(input);

    const callArgs = vi.mocked(execa).mock.calls[0];
    expect(callArgs[1]).toContain("-c");
    expect(callArgs[1]).toContain('mcp_servers.codegraph.command="codegraph"');
    expect(callArgs[1]).toContain('mcp_servers.codegraph.args=["serve","--mcp"]');
  });
});
