import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import { runStageActivity } from "../../activities/stage-activities.js";

describe("stage activities", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
    runtimeFactory.createAgentRuntime.mockReturnValue(runtimeFactory.runtime);
    stageRunner.runStage.mockResolvedValue({
      taskId: "TASK-ACTIVITY-001",
      stage: "analyze_requirements",
      status: "succeeded",
      summary: "ok",
      outputArtifacts: [],
    });
  });

  afterEach(async () => {
    if (tempDir) {
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("runs stages in the provided worktree while keeping artifacts under the platform cwd", async () => {
    const worktreePath = "/tmp/prepared-worktree";

    await runStageActivity("TASK-ACTIVITY-001", "analyze_requirements", "pi", worktreePath);

    expect(stageRunner.runStage.mock.calls[0][0]).toEqual(expect.objectContaining({
      taskId: "TASK-ACTIVITY-001",
      stage: "analyze_requirements",
      worktreePath,
      artifactRoot: resolve(process.cwd(), "artifacts/tasks/TASK-ACTIVITY-001"),
      context: undefined,
    }));
  });

  it("falls back to the task repo when no worktree path is provided", async () => {
    tempDir = await mkdtemp(resolve(tmpdir(), "pi-stage-activity-"));
    process.chdir(tempDir);

    const taskId = "TASK-ACTIVITY-REPO";
    const repoPath = resolve(tempDir, "target-repo");
    await mkdir(resolve(tempDir, "artifacts/tasks", taskId), { recursive: true });
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      resolve(tempDir, "artifacts/tasks", taskId, "task.json"),
      JSON.stringify({ id: taskId, repo: repoPath, baseBranch: "main" }) + "\n",
      "utf-8"
    );

    await runStageActivity(taskId, "codegraph_impact", "pi");

    expect(stageRunner.runStage.mock.calls[0][0]).toEqual(expect.objectContaining({
      taskId,
      stage: "codegraph_impact",
      worktreePath: repoPath,
      artifactRoot: resolve(tempDir, "artifacts/tasks", taskId),
    }));
  });
});
