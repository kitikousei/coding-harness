import type { Command } from "commander";
import { resolve } from "path";
import { mkdir, writeFile } from "fs/promises";
import * as readline from "readline";
import { FileBasedRegistry } from "../../capability/CapabilityRegistry.js";
import { DefaultStageEnforcer } from "../../capability/StageEnforcer.js";
import { DummyMCPServerManager } from "../../capability/MCPServerManager.js";
import { FileSkillLoader } from "../../capability/SkillLoader.js";
import { DefaultOutputValidator } from "../../capability/OutputValidator.js";
import { LocalArtifactStore } from "../../artifacts/LocalArtifactStore.js";
import { runStage } from "../../stages/runStage.js";
import { FileBasedTestCommandResolver } from "../../testing/TestCommandResolver.js";
import { DefaultTestRunner } from "../../testing/TestRunner.js";
import { DefaultWorkspaceManager } from "../../workspace/WorkspaceManager.js";
import type { AgentRuntime } from "../../agent-runtimes/AgentRuntime.js";
import { createAgentRuntime } from "../../agent-runtimes/RuntimeFactory.js";
import { resolveTaskWorktreePath } from "../../tasks/TaskMetadata.js";

async function waitForApproval(stage: string, taskId: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n=== Approval required for stage: ${stage} (task: ${taskId}) ===`);
  console.log("Type 'approve' or 'reject' to continue:");

  return new Promise<boolean>((resolve) => {
    rl.question("> ", (answer) => {
      rl.close();
      const decision = answer.trim().toLowerCase();
      if (decision === "approve" || decision === "approved") {
        console.log(`  Stage '${stage}' approved.`);
        resolve(true);
      } else {
        console.log(`  Stage '${stage}' rejected.`);
        resolve(false);
      }
    });
  });
}

const STAGES = [
  "normalize_requirements",
  "analyze_requirements",
  "codegraph_impact",
  "write_implementation_plan",
  "write_tests",
  "implement_code",
];

const POST_IMPLEMENT_STAGES = [
  "fix_test_failures",
  "review_diff",
  "publish_final_report",
];

export function runMvpCommand(program: Command) {
  program
    .command("run-mvp")
    .description("Run the full MVP workflow")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--runtime <runtime>", "Runtime to use (mock|pi|pi-cli|codex)", "mock")
    .option("--repo <path>", "Repository path")
    .option("--wait-approval", "Pause for manual approval at requirements and plan stages (uses readline)")
    .option("--auto-approve", "Skip all approval prompts (default behavior)", false)
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

      const worktreePath = await resolveTaskWorktreePath(opts.task, opts.repo);
      const artifactRoot = resolve(process.cwd(), `artifacts/tasks/${opts.task}`);

      const waitApproval = opts.waitApproval === true;
      const autoApprove = opts.autoApprove === true || !waitApproval;

      console.log(`Starting MVP workflow for task ${opts.task} with runtime ${opts.runtime}${waitApproval ? " (approval gates enabled)" : " (auto-approve)"}`);

      // Run pre-implementation stages
      for (const stage of STAGES) {
        // Approval checkpoint: requirements after normalize
        if (stage === "analyze_requirements" && waitApproval && !autoApprove) {
          const approved = await waitForApproval("requirements", opts.task);
          if (!approved) {
            console.error("\nRequirements approval rejected. Stopping workflow.");
            await artifactStore.appendEvent(opts.task, {
              taskId: opts.task,
              stage: "requirements",
              event: "stage.blocked",
              createdAt: new Date().toISOString(),
              summary: "Requirements rejected by user.",
            });
            process.exitCode = 1;
            return;
          }
          await artifactStore.appendEvent(opts.task, {
            taskId: opts.task,
            stage: "requirements",
            event: "stage.completed",
            createdAt: new Date().toISOString(),
            summary: "Requirements approved by user (CLI).",
          });
        }

        // Approval checkpoint: plan after write_implementation_plan
        if (stage === "write_tests" && waitApproval && !autoApprove) {
          const approved = await waitForApproval("plan", opts.task);
          if (!approved) {
            console.error("\nPlan approval rejected. Stopping workflow.");
            await artifactStore.appendEvent(opts.task, {
              taskId: opts.task,
              stage: "plan",
              event: "stage.blocked",
              createdAt: new Date().toISOString(),
              summary: "Plan rejected by user.",
            });
            process.exitCode = 1;
            return;
          }
          await artifactStore.appendEvent(opts.task, {
            taskId: opts.task,
            stage: "plan",
            event: "stage.completed",
            createdAt: new Date().toISOString(),
            summary: "Plan approved by user (CLI).",
          });
        }

        console.log(`\n--- Running stage: ${stage} ---`);
        const result = await runStage({
          taskId: opts.task,
          stage,
          worktreePath,
          artifactRoot,
          runtime,
          approvedOperations: [],
        }, deps);

        console.log(`  ${result.status}: ${result.summary}`);

        if (result.status === "blocked" || (result.status === "failed" && !result.error?.retryable)) {
          console.error(`\nWorkflow blocked at stage ${stage}. Stopping.`);
          process.exitCode = 1;
          return;
        }

        if (result.status === "failed" && result.error?.retryable) {
          console.log(`  Retrying stage ${stage}...`);
          const retryResult = await runStage({
            taskId: opts.task,
            stage,
            worktreePath,
            artifactRoot,
            runtime,
            approvedOperations: [],
          }, deps);
          console.log(`  Retry ${retryResult.status}: ${retryResult.summary}`);
          if (retryResult.status !== "succeeded") {
            console.error(`\nStage ${stage} failed after retry. Stopping.`);
            process.exitCode = 1;
            return;
          }
        }
      }

      // Collect diff after implementation stages
      console.log("\n--- Collecting diff ---");
      const workspaceManager = new DefaultWorkspaceManager();
      try {
        const diff = await workspaceManager.collectDiff(worktreePath);
        if (diff) {
          const diffPath = resolve(artifactRoot, "diff.patch");
          await mkdir(resolve(artifactRoot, ".."), { recursive: true });
          await writeFile(diffPath, diff, "utf-8");
          console.log(`  diff.patch written (${diff.length} bytes)`);
          await artifactStore.appendEvent(opts.task, {
            taskId: opts.task,
            stage: "collect_diff",
            event: "stage.completed",
            createdAt: new Date().toISOString(),
            summary: `Diff collected: ${diff.length} bytes`,
          });
        } else {
          console.log("  No diff to collect.");
        }
      } catch (err: any) {
        console.log(`  Warning: could not collect diff: ${err.message}`);
      }

      // Run tests
      console.log("\n--- Running tests ---");
      const testResolver = new FileBasedTestCommandResolver();
      const testRunner = new DefaultTestRunner();
      const testCommands = await testResolver.resolve(worktreePath);

      if (testCommands.length > 0) {
        const testResult = await testRunner.runTests(testCommands, opts.task, worktreePath, artifactStore);
        console.log(`  Tests passed: ${testResult.passed}`);

        if (!testResult.passed) {
          // Retry fix up to 3 times
          for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`\n--- Fix attempt ${attempt} ---`);
            await runStage({
              taskId: opts.task,
              stage: "fix_test_failures",
              worktreePath,
              artifactRoot,
              runtime,
              approvedOperations: [],
              context: { attempt },
            }, deps);

            const retest = await testRunner.runTests(testCommands, opts.task, worktreePath, artifactStore);
            console.log(`  Attempt ${attempt} tests passed: ${retest.passed}`);
            if (retest.passed) break;

            if (attempt === 3) {
              console.error("\nTests failed after 3 fix attempts. Marking as tests_failed_needs_human.");
              await artifactStore.appendEvent(opts.task, {
                taskId: opts.task,
                stage: "fix_test_failures",
                event: "stage.blocked",
                createdAt: new Date().toISOString(),
                summary: "Tests failed after 3 fix attempts. Needs human intervention.",
              });
            }
          }
        }
      } else {
        console.log("  No test commands detected. Skipping.");
      }

      // Run post-implementation stages
      for (const stage of POST_IMPLEMENT_STAGES) {
        console.log(`\n--- Running stage: ${stage} ---`);
        const result = await runStage({
          taskId: opts.task,
          stage,
          worktreePath,
          artifactRoot,
          runtime,
          approvedOperations: [],
        }, deps);

        console.log(`  ${result.status}: ${result.summary}`);

        if (result.status === "failed") {
          console.error(`\nStage ${stage} failed. Continuing to next stage.`);
        }
      }

      console.log(`\nMVP workflow for ${opts.task} completed.`);
      console.log(`Artifacts at: ${artifactRoot}`);
    });
}
