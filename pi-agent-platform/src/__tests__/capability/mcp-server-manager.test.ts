import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { DummyMCPServerManager } from "../../capability/MCPServerManager.js";
import { StageBlockedError } from "../../capability/errors.js";
import type { StageCapabilityManifest } from "../../capability/StageCapabilityManifest.js";

function makeManifest(overrides: Partial<StageCapabilityManifest> = {}): StageCapabilityManifest {
  return {
    stage: "test_stage",
    tools: { native: ["read_file"], mcp: [], skills: [] },
    sandbox: "read-only",
    promptTemplate: "prompts/test.md",
    outputs: [{ path: "artifacts/tasks/${taskId}/output.md", required: true }],
    constraints: {
      maxAgentRuns: 1,
      maxToolCallsPerRun: 10,
      maxDurationMs: 60000,
      allowSubagents: false,
      requireOutputFile: true,
      validateOutputSchema: false,
    },
    ...overrides,
  };
}

describe("MCPServerManager", () => {
  const manager = new DummyMCPServerManager();
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "mcp-server-manager-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function makeIndexedProject(name = "project") {
    const projectPath = resolve(tempRoot, name);
    await mkdir(resolve(projectPath, ".codegraph"), { recursive: true });
    await writeFile(resolve(projectPath, ".codegraph", "codegraph.db"), "");
    return projectPath;
  }

  it("returns empty started when no mcpServers", async () => {
    const manifest = makeManifest();
    const result = await manager.startServers(manifest, { worktreePath: tempRoot });
    expect(result.started).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns codegraph MCP runtime config when the worktree has an index", async () => {
    const projectPath = await makeIndexedProject();
    const manifest = makeManifest({
      mcpServers: [{ id: "codegraph-mcp", required: true }],
    });

    const result = await manager.startServers(manifest, { worktreePath: projectPath });

    expect(result.started).toEqual([
      {
        id: "codegraph-mcp",
        command: "codegraph",
        args: ["serve", "--mcp"],
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("blocks when required codegraph MCP is missing its worktree index", async () => {
    const manifest = makeManifest({
      mcpServers: [{ id: "codegraph-mcp", required: true }],
    });

    await expect(manager.startServers(manifest, { worktreePath: tempRoot })).rejects.toThrow(StageBlockedError);
  });

  it("warns when optional MCP is missing its worktree index", async () => {
    const manifest = makeManifest({
      mcpServers: [{ id: "codegraph-mcp", required: false }],
    });

    const result = await manager.startServers(manifest, { worktreePath: tempRoot });

    expect(result.started).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("stops servers after stage", async () => {
    const projectPath = await makeIndexedProject();
    const manifest = makeManifest({
      mcpServers: [{ id: "codegraph-mcp", required: true }],
    });

    await manager.startServers(manifest, { worktreePath: projectPath });
    await manager.stopServers(manifest);
    // Stopping twice should not throw
    await manager.stopServers(manifest);
  });
});
