import { Command } from "commander";
import { Client, Connection } from "@temporalio/client";
import type { ApprovalSignal } from "../../workflows/TaskWorkflowContract.js";
import { APPROVAL_SIGNAL_NAME } from "../../workflows/TaskWorkflowContract.js";
import { normalizeOptionalPath } from "../../tasks/TaskMetadata.js";

export const approvalSignalName = APPROVAL_SIGNAL_NAME;

function makeClient(): Client {
  const address = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  return new Client({
    connection: Connection.lazy({ address }),
  });
}

export function workflowCommands(program: Command) {
  const workflowCmd = program
    .command("workflow")
    .description("Manage Temporal workflows");

  workflowCmd
    .command("start")
    .description("Start a new workflow execution")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--title <title>", "Task title", "")
    .option("--repo <repo>", "Repository path", "")
    .option("--base <branch>", "Base branch", "main")
    .option("--input <file>", "Input file path", "")
    .option("--runtime <runtime>", "Runtime to use (mock|pi|pi-cli|codex)", "mock")
    .option("--model <model>", "Pi model pattern (e.g. 'qwen3.6-plus', 'deepseek-v4-pro')")
    .option("--provider <provider>", "Pi provider name (e.g. 'dashscope', 'google')")
    .action(async (opts: any) => {
      const client = makeClient();

      // Write input file to task directory before starting workflow
      if (opts.input) {
        const { readFile, mkdir, writeFile } = await import("fs/promises");
        const { resolve } = await import("path");
        const taskDir = resolve(process.cwd(), `artifacts/tasks/${opts.task}`);
        const sourcePath = resolve(process.cwd(), opts.input);
        const content = await readFile(sourcePath, "utf-8");
        await mkdir(taskDir, { recursive: true });
        await writeFile(resolve(taskDir, "input.md"), content);
      }

      const handle = await client.workflow.start("LongEngineeringTaskWorkflow", {
        taskQueue: "pi-agent-tasks",
        workflowId: `pi-agent-${opts.task}`,
        args: [
          {
            taskId: opts.task,
            title: opts.title || opts.task,
            repo: normalizeOptionalPath(opts.repo),
            baseBranch: opts.base || "main",
            inputFile: opts.input || "",
            approvalPolicy: "requirements_and_plan",
            testPolicy: "unit_tests_required",
            runtime: opts.runtime || "mock",
            model: opts.model || undefined,
            provider: opts.provider || undefined,
          },
        ],
      });

      console.log(`Workflow started. Workflow ID: ${handle.workflowId}`);
      console.log(`Run ID: ${handle.firstExecutionRunId}`);
      console.log(`Check status: pnpm pi-agent-platform workflow status --workflow-id ${handle.workflowId}`);
    });

  workflowCmd
    .command("status")
    .description("Check workflow status")
    .requiredOption("--workflow-id <id>", "Workflow ID")
    .action(async (opts: any) => {
      const client = makeClient();

      const handle = client.workflow.getHandle(opts.workflowId);
      const description = await handle.describe();

      console.log(`Workflow ID: ${description.workflowId}`);
      console.log(`Run ID: ${description.runId}`);
      console.log(`Status: ${formatWorkflowExecutionStatus(description.status)}`);
      console.log(`Type: ${description.type}`);
    });

  workflowCmd
    .command("signal")
    .description("Send approval signal to workflow")
    .requiredOption("--workflow-id <id>", "Workflow ID")
    .requiredOption("--stage <stage>", "Approval stage (requirements|plan|diff|pr)")
    .requiredOption("--decision <decision>", "Decision (approved|rejected)")
    .option("--comment <comment>", "Comment", "")
    .option("--reviewer <reviewer>", "Reviewer name", "cli")
    .action(async (opts: any) => {
      const client = makeClient();

      const handle = client.workflow.getHandle(opts.workflowId);
      const signal: ApprovalSignal = {
        taskId: opts.workflowId.replace("pi-agent-", ""),
        stage: opts.stage,
        decision: opts.decision,
        comment: opts.comment,
        reviewer: opts.reviewer,
        decidedAt: new Date().toISOString(),
      };

      await handle.signal(approvalSignalName, signal);
      console.log(`Approval signal sent: ${opts.decision} for ${opts.stage}`);
    });

  workflowCmd
    .command("cancel")
    .description("Cancel a workflow execution")
    .requiredOption("--workflow-id <id>", "Workflow ID")
    .action(async (opts: any) => {
      const client = makeClient();

      const handle = client.workflow.getHandle(opts.workflowId);
      await handle.cancel();
      console.log(`Workflow ${opts.workflowId} cancelled`);
    });
}

export function formatWorkflowExecutionStatus(status: unknown): string {
  if (typeof status === "object" && status !== null && typeof (status as { name?: unknown }).name === "string") {
    return (status as { name: string }).name;
  }
  return typeof status === "string" ? status : JSON.stringify(status);
}
