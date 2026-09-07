import type { SensitiveOperation } from "../capability/StageCapabilityManifest.js";
import type { AgentRuntime, AgentRunResult } from "../agent-runtimes/AgentRuntime.js";
import type { ArtifactStore } from "../artifacts/LocalArtifactStore.js";
import type { CapabilityRegistry } from "../capability/CapabilityRegistry.js";
import type { StageEnforcer } from "../capability/StageEnforcer.js";
import type { MCPServerManager } from "../capability/MCPServerManager.js";
import type { SkillLoader } from "../capability/SkillLoader.js";
import type { OutputValidator } from "../capability/OutputValidator.js";
import { StageBlockedError } from "../capability/errors.js";
import { buildPrompt } from "./buildPrompt.js";
import { taskArtifactRoot } from "../artifacts/TaskArtifactPaths.js";
import { CostTracker } from "../cost/CostTracker.js";
import { resolve } from "path";

const DEFAULT_STAGE_TIMEOUT_MS = 300_000;

export interface RunStageInput {
  taskId: string;
  stage: string;
  worktreePath: string;
  artifactRoot: string;
  runtime: AgentRuntime;
  approvedOperations: SensitiveOperation[];
  context?: Record<string, unknown>;
  model?: string;
  provider?: string;
  repoPath?: string;
}

export interface StageResult {
  taskId: string;
  stage: string;
  status: "succeeded" | "failed" | "blocked" | "needs_input";
  summary: string;
  outputArtifacts: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  error?: {
    type: string;
    message: string;
    retryable: boolean;
  };
}

export interface StageDeps {
  registry: CapabilityRegistry;
  enforcer: StageEnforcer;
  mcpManager: MCPServerManager;
  skillLoader: SkillLoader;
  outputValidator: OutputValidator;
  artifactStore: ArtifactStore;
}

export async function runStage(input: RunStageInput, deps: StageDeps): Promise<StageResult> {
  const { registry, enforcer, mcpManager, skillLoader, outputValidator, artifactStore } = deps;
  const costTracker = new CostTracker(artifactStore);
  const stageStartedAt = new Date().toISOString();

  // 1. Load manifest
  const manifest = await registry.loadManifest(input.stage);
  const allowedTools = registry.resolveAllowedTools(manifest);
  for (const tool of allowedTools) {
    enforcer.assertToolAllowed(manifest, tool);
  }
  const allowedOutputPaths = resolveAllowedOutputPaths(input, manifest.outputs);

  // Record stage started
  await artifactStore.appendEvent(input.taskId, {
    taskId: input.taskId,
    stage: input.stage,
    event: "stage.started",
    createdAt: new Date().toISOString(),
    summary: `Stage ${input.stage} started.`,
  });

  try {
    // 2. Start MCP servers
    const mcpResult = await mcpManager.startServers(manifest, {
      worktreePath: input.worktreePath || process.cwd(),
      repoPath: input.repoPath,
    });
    for (const warn of mcpResult.warnings) {
      await artifactStore.appendEvent(input.taskId, {
        taskId: input.taskId,
        stage: input.stage,
        event: "stage.warning",
        createdAt: new Date().toISOString(),
        summary: warn,
      });
    }

    // 3. Load skills
    const skills = await skillLoader.loadSkills(manifest.tools.skills);
    for (const skill of skills) {
      for (const warn of skill.warnings) {
        await artifactStore.appendEvent(input.taskId, {
          taskId: input.taskId,
          stage: input.stage,
          event: "stage.warning",
          createdAt: new Date().toISOString(),
          summary: warn,
        });
      }
    }

    // 4. Build prompt
    const prompt = await buildPrompt(manifest, {
      taskId: input.taskId,
      artifactRoot: input.artifactRoot,
      worktreePath: input.worktreePath,
    }, skills, input.context);
    await artifactStore.writeText(input.taskId, `${input.stage}.prompt.md`, prompt);

    // 5. Run agent
    const runResult: AgentRunResult = await input.runtime.run({
      taskId: input.taskId,
      stage: input.stage,
      cwd: input.worktreePath || process.cwd(),
      prompt,
      sandbox: manifest.sandbox,
      tools: allowedTools,
      mcpServers: mcpResult.started,
      artifactRoot: input.artifactRoot,
      allowedOutputPaths,
      timeoutMs: DEFAULT_STAGE_TIMEOUT_MS,
      maxToolCallsPerRun: manifest.constraints.maxToolCallsPerRun,
      context: input.context,
      model: input.model,
      provider: input.provider,
    });

    const recoverableToolFailure = isRecoverableToolExecutionFailure(runResult);

    if (runResult.status === "failed" && !recoverableToolFailure) {
      await artifactStore.appendEvent(input.taskId, {
        taskId: input.taskId,
        stage: input.stage,
        event: "stage.failed",
        createdAt: new Date().toISOString(),
        summary: runResult.summary,
        data: { error: runResult.error },
      });
      return {
        taskId: input.taskId,
        stage: input.stage,
        status: "failed",
        summary: runResult.summary,
        outputArtifacts: [],
        error: runResult.error,
      };
    }

    if (runResult.status === "needs_input") {
      await artifactStore.appendEvent(input.taskId, {
        taskId: input.taskId,
        stage: input.stage,
        event: "stage.blocked",
        createdAt: new Date().toISOString(),
        summary: runResult.summary,
      });
      return {
        taskId: input.taskId,
        stage: input.stage,
        status: "needs_input",
        summary: runResult.summary,
        outputArtifacts: runResult.outputArtifacts ?? [],
      };
    }

    // 6. Validate outputs
    const validation = await outputValidator.validateOutputs(input.taskId, manifest, input.artifactRoot);
    if (!validation.valid) {
      await artifactStore.appendEvent(input.taskId, {
        taskId: input.taskId,
        stage: input.stage,
        event: "stage.failed",
        createdAt: new Date().toISOString(),
        summary: "Output validation failed: " + validation.errors.join("; "),
        data: {
          error: {
            type: "output_validation_error",
            message: validation.errors.join("; "),
            retryable: true,
          },
        },
      });
      return {
        taskId: input.taskId,
        stage: input.stage,
        status: "failed",
        summary: "Output validation failed",
        outputArtifacts: [],
        error: {
          type: "output_validation_error",
          message: validation.errors.join("; "),
          retryable: true,
        },
      };
    }

    const completionSummary = recoverableToolFailure
      ? `${runResult.summary}; required outputs validated`
      : runResult.summary;

    if (recoverableToolFailure) {
      await artifactStore.appendEvent(input.taskId, {
        taskId: input.taskId,
        stage: input.stage,
        event: "stage.warning",
        createdAt: new Date().toISOString(),
        summary: `${runResult.summary}; continuing because required outputs validated.`,
        data: { error: runResult.error },
      });
    }

    // Record cost/token usage for this stage
    const stageCompletedAt = new Date().toISOString();
    const usage = runResult.usage;
    if (usage && (usage.inputTokens || usage.outputTokens)) {
      await costTracker.recordStageCost(input.taskId, {
        stage: input.stage,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        model: input.model,
        startedAt: stageStartedAt,
        completedAt: stageCompletedAt,
      }).catch(() => {
        // Cost tracking must not fail the stage
      });
    }

    // 7. Success
    await artifactStore.appendEvent(input.taskId, {
      taskId: input.taskId,
      stage: input.stage,
      event: "stage.completed",
      createdAt: stageCompletedAt,
      summary: completionSummary,
    });

    return {
      taskId: input.taskId,
      stage: input.stage,
      status: "succeeded",
      summary: completionSummary,
      outputArtifacts: runResult.outputArtifacts ?? [],
      usage: runResult.usage,
    };
  } catch (err: any) {
    const blocked = err instanceof StageBlockedError || err?.type === "stage_blocked";
    await artifactStore.appendEvent(input.taskId, {
      taskId: input.taskId,
      stage: input.stage,
      event: blocked ? "stage.blocked" : "stage.failed",
      createdAt: new Date().toISOString(),
      summary: err.message,
    });
    return {
      taskId: input.taskId,
      stage: input.stage,
      status: blocked ? "blocked" : "failed",
      summary: err.message,
      outputArtifacts: [],
      error: {
        type: err.type || "stage_execution_error",
        message: err.message,
        retryable: err.retryable ?? true,
      },
    };
  } finally {
    // 8. Stop MCP servers
    await mcpManager.stopServers(manifest);
  }
}

function resolveAllowedOutputPaths(
  input: RunStageInput,
  outputs: Array<{ path: string }>
): string[] {
  return outputs.map((output) => {
    let outputPath = output.path
      .replace("${taskId}", input.taskId)
      .replace("${artifactRoot}", input.artifactRoot);

    if (outputPath.includes("${attempt}")) {
      outputPath = outputPath.replace(
        "${attempt}",
        String(input.context?.attempt ?? 1)
      );
    }

    return outputPath.startsWith("/") ? outputPath : resolve(process.cwd(), outputPath);
  });
}

function isRecoverableToolExecutionFailure(runResult: AgentRunResult): boolean {
  return runResult.status === "failed"
    && runResult.error?.type === "tool_execution_error"
    && runResult.error.retryable === true;
}
