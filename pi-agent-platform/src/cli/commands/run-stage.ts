import type { Command } from "commander";
import { resolve } from "path";
import { FileBasedRegistry } from "../../capability/CapabilityRegistry.js";
import { DefaultStageEnforcer } from "../../capability/StageEnforcer.js";
import { DummyMCPServerManager } from "../../capability/MCPServerManager.js";
import { FileSkillLoader } from "../../capability/SkillLoader.js";
import { DefaultOutputValidator } from "../../capability/OutputValidator.js";
import { LocalArtifactStore } from "../../artifacts/LocalArtifactStore.js";
import { runStage } from "../../stages/runStage.js";
import type { AgentRuntime } from "../../agent-runtimes/AgentRuntime.js";
import { createAgentRuntime } from "../../agent-runtimes/RuntimeFactory.js";
import { resolveTaskWorktreePath } from "../../tasks/TaskMetadata.js";

export function runStageCommand(program: Command) {
  program
    .command("run-stage")
    .description("Run a single stage")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--stage <stage>", "Stage name")
    .option("--runtime <runtime>", "Runtime to use (mock|pi|pi-cli|codex)", "mock")
    .option("--worktree <path>", "Worktree path")
    .option("--repo <path>", "Repository path (alias for --worktree)")
    .action(async (opts: any) => {
      const artifactStore = new LocalArtifactStore();
      await artifactStore.ensureTask(opts.task);

      const runtime: AgentRuntime = createAgentRuntime(opts.runtime);

      const deps = {
        registry: new FileBasedRegistry(),
        enforcer: new DefaultStageEnforcer(),
        mcpManager: new DummyMCPServerManager(),
        skillLoader: new FileSkillLoader(),
        outputValidator: new DefaultOutputValidator(),
        artifactStore,
      };

      const worktreePath = await resolveTaskWorktreePath(opts.task, opts.worktree || opts.repo);
      const artifactRoot = resolve(process.cwd(), `artifacts/tasks/${opts.task}`);

      const result = await runStage({
        taskId: opts.task,
        stage: opts.stage,
        worktreePath,
        artifactRoot,
        runtime,
        approvedOperations: [],
      }, deps);

      console.log(`Stage: ${result.stage}`);
      console.log(`Status: ${result.status}`);
      console.log(`Summary: ${result.summary}`);
      if (result.error) {
        console.error(`Error: ${result.error.type} - ${result.error.message}`);
        process.exitCode = 1;
      }
    });
}
