import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { resolve } from "path";

const stageRunner = vi.hoisted(() => ({
  runStage: vi.fn(),
}));

const runtimeFactory = vi.hoisted(() => ({
  runtime: { run: vi.fn() },
  createAgentRuntime: vi.fn(),
}));

vi.mock("../../stages/runStage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stages/runStage.js")>();
  return {
    ...actual,
    runStage: stageRunner.runStage,
  };
});

vi.mock("../../agent-runtimes/RuntimeFactory.js", () => ({
  createAgentRuntime: runtimeFactory.createAgentRuntime,
}));

import { runStageCommand } from "../../cli/commands/run-stage.js";

describe("run-stage CLI", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
    tempDir = await mkdtemp(resolve(tmpdir(), "pi-run-stage-"));
    process.chdir(tempDir);
    runtimeFactory.createAgentRuntime.mockReturnValue(runtimeFactory.runtime);
    stageRunner.runStage.mockResolvedValue({
      taskId: "TASK-CLI-REPO",
      stage: "codegraph_impact",
      status: "succeeded",
      summary: "ok",
      outputArtifacts: [],
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses the task repo metadata when --worktree is omitted", async () => {
    const taskId = "TASK-CLI-REPO";
    const repoPath = resolve(tempDir, "target-repo");
    await mkdir(resolve(tempDir, "artifacts/tasks", taskId), { recursive: true });
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      resolve(tempDir, "artifacts/tasks", taskId, "task.json"),
      JSON.stringify({ id: taskId, repo: repoPath, baseBranch: "main" }) + "\n",
      "utf-8"
    );

    const program = new Command();
    program.exitOverride();
    runStageCommand(program);

    await program.parseAsync([
      "node",
      "test",
      "run-stage",
      "--task",
      taskId,
      "--stage",
      "codegraph_impact",
      "--runtime",
      "pi",
    ]);

    expect(stageRunner.runStage.mock.calls[0][0]).toEqual(expect.objectContaining({
      taskId,
      stage: "codegraph_impact",
      worktreePath: repoPath,
      artifactRoot: resolve(tempDir, "artifacts/tasks", taskId),
    }));
  });
});
