import { Context } from "@temporalio/activity";
import { resolve } from "path";
import { FileBasedRegistry } from "../capability/CapabilityRegistry.js";
import { DefaultStageEnforcer } from "../capability/StageEnforcer.js";
import { DummyMCPServerManager } from "../capability/MCPServerManager.js";
import { FileSkillLoader } from "../capability/SkillLoader.js";
import { DefaultOutputValidator } from "../capability/OutputValidator.js";
import { LocalArtifactStore } from "../artifacts/LocalArtifactStore.js";
import { runStage as _runStage, type RunStageInput, type StageResult } from "../stages/runStage.js";
import { createAgentRuntime } from "../agent-runtimes/RuntimeFactory.js";
import type { AgentRuntime } from "../agent-runtimes/AgentRuntime.js";
import type { TestResult } from "../testing/TestRunner.js";
import { FileBasedTestCommandResolver } from "../testing/TestCommandResolver.js";
import { DefaultTestRunner } from "../testing/TestRunner.js";
import type { PreparedWorkspace } from "../workspace/WorkspaceManager.js";
import { GitWorktreeManager, DefaultWorkspaceManager } from "../workspace/WorkspaceManager.js";
import { collectDiffActivity, publishFinalReportActivity } from "./report-activities.js";
import { normalizeOptionalPath, resolveTaskWorktreePath, taskDirectory, writeTaskMetadata, readTaskMetadata } from "../tasks/TaskMetadata.js";

// Re-export report activities so Worker can access them through the same import
export { collectDiffActivity, publishFinalReportActivity };

function makeDeps(runtime: AgentRuntime, taskDir?: string) {
  const artifactStore = new LocalArtifactStore(taskDir);
  return {
    registry: new FileBasedRegistry(),
    enforcer: new DefaultStageEnforcer(),
    mcpManager: new DummyMCPServerManager(),
    skillLoader: new FileSkillLoader(),
    outputValidator: new DefaultOutputValidator(),
    artifactStore,
  };
}

export async function createTaskActivity(input: {
  taskId: string;
  title: string;
  inputFile?: string;
  repo?: string;
  baseBranch?: string;
}): Promise<{ id: string }> {
  const artifactStore = new LocalArtifactStore();
  await artifactStore.ensureTask(input.taskId);
  console.log(`createTaskActivity: cwd=${process.cwd()}, taskId=${input.taskId}, title=${input.title}, inputFile=${input.inputFile}`);
  await writeTaskMetadata(input.taskId, {
    id: input.taskId,
    title: input.title,
    repo: normalizeOptionalPath(input.repo),
    baseBranch: input.baseBranch || "main",
    createdAt: new Date().toISOString(),
    status: "created",
  });
  await artifactStore.appendEvent(input.taskId, {
    taskId: input.taskId,
    event: "task.created",
    createdAt: new Date().toISOString(),
    summary: `Task created: ${input.title}`,
  });

  // Copy input file to task directory if provided
  if (input.inputFile) {
    const { readFile, mkdir, writeFile } = await import("fs/promises");
    const { resolve } = await import("path");
    const taskDir = taskDirectory(input.taskId);
    // Handle both absolute and relative paths
    const sourcePath = input.inputFile.startsWith("/") ? input.inputFile : resolve(process.cwd(), input.inputFile);
    console.log(`Reading input from: ${sourcePath}`);
    const content = await readFile(sourcePath, "utf-8");
    await mkdir(taskDir, { recursive: true });
    await writeFile(resolve(taskDir, "input.md"), content);
    console.log(`Wrote input.md to ${taskDir}`);
  }

  return { id: input.taskId };
}

export async function runStageActivity(
  taskId: string,
  stage: string,
  runtime: string,
  worktreePathOrContext?: string | Record<string, unknown>,
  context?: Record<string, unknown>
): Promise<StageResult> {
  const agentRuntime = createAgentRuntime(runtime);
  const deps = makeDeps(agentRuntime);
  const { worktreePath, stageContext } = await normalizeRunStageActivityArgs(taskId, worktreePathOrContext, context);

  const artifactRoot = resolve(process.cwd(), `artifacts/tasks/${taskId}`);

  // Read repo path from task metadata for codegraph MCP server
  const metadata = await readTaskMetadata(taskId);
  const repoPath = metadata?.repo || undefined;

  return _runStage(
    {
      taskId,
      stage,
      worktreePath,
      artifactRoot,
      runtime: agentRuntime,
      approvedOperations: [],
      context: stageContext,
      model: typeof stageContext?.model === "string" ? stageContext.model : undefined,
      provider: typeof stageContext?.provider === "string" ? stageContext.provider : undefined,
      repoPath,
    },
    deps
  );
}

async function normalizeRunStageActivityArgs(
  taskId: string,
  worktreePathOrContext?: string | Record<string, unknown>,
  context?: Record<string, unknown>
): Promise<{ worktreePath: string; stageContext?: Record<string, unknown> }> {
  if (typeof worktreePathOrContext === "string") {
    return {
      worktreePath: await resolveTaskWorktreePath(taskId, worktreePathOrContext),
      stageContext: context,
    };
  }

  return {
    worktreePath: await resolveTaskWorktreePath(taskId),
    stageContext: worktreePathOrContext,
  };
}

export async function prepareWorkspaceActivity(
  taskId: string,
  repo: string,
  baseBranch: string
): Promise<PreparedWorkspace> {
  const workspaceRoot = process.cwd();
  const resolvedRepo = normalizeOptionalPath(repo);
  const manager = new DefaultWorkspaceManager(new GitWorktreeManager());
  const result = await manager.prepareWorkspace({
    taskId,
    repo: resolvedRepo,
    baseBranch,
    workspaceRoot,
  });

  // Symlink codegraph index from original repo so Pi can use codegraph in worktree
  const { symlink, access } = await import("fs/promises");
  const srcCodeGraph = resolve(resolvedRepo, ".codegraph");
  const dstCodeGraph = resolve(result.worktreePath, ".codegraph");
  try {
    await access(srcCodeGraph);
    await symlink(srcCodeGraph, dstCodeGraph, "dir").catch(() => {});
  } catch {
    // Original repo has no .codegraph index — skip
  }

  return result;
}

export async function runTestsActivity(taskId: string, worktreePath?: string): Promise<TestResult> {
  const artifactStore = new LocalArtifactStore();

  const resolver = new FileBasedTestCommandResolver();
  const runner = new DefaultTestRunner();
  const resolvedWorktreePath = await resolveTaskWorktreePath(taskId, worktreePath);
  const commands = await resolver.resolve(resolvedWorktreePath);

  if (commands.length === 0) {
    return { passed: true, commands: [], failedTests: [], logFile: "" };
  }

  return runner.runTests(commands, taskId, resolvedWorktreePath, artifactStore);
}
