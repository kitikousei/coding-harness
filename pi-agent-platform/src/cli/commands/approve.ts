import { Command } from "commander";
import { Client, Connection } from "@temporalio/client";
import type { ApprovalSignal } from "../../workflows/TaskWorkflowContract.js";
import { approvalSignalName } from "./workflow.js";

function makeClient(): Client {
  const address = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  return new Client({
    connection: Connection.lazy({ address }),
  });
}

export function approveCommand(program: Command) {
  program
    .command("approve")
    .description("Approve or reject a workflow stage (shortcut for workflow signal)")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--stage <stage>", "Approval stage (requirements|plan|diff|pr)")
    .requiredOption("--decision <decision>", "Decision (approved|rejected)")
    .option("--comment <comment>", "Review comment", "")
    .option("--reviewer <reviewer>", "Reviewer name", "cli")
    .option("--workflow-id <workflowId>", "Workflow ID (default: pi-agent-<taskId>)")
    .action(async (opts: any) => {
      const client = makeClient();
      const workflowId = opts.workflowId || `pi-agent-${opts.task}`;
      const handle = client.workflow.getHandle(workflowId);

      const signal: ApprovalSignal = {
        taskId: opts.task,
        stage: opts.stage,
        decision: opts.decision,
        comment: opts.comment,
        reviewer: opts.reviewer,
        decidedAt: new Date().toISOString(),
      };

      await handle.signal(approvalSignalName, signal);
      console.log(`Approval sent: ${opts.decision} for stage '${opts.stage}' on task '${opts.task}'`);
      console.log(`Workflow: ${workflowId}`);
    });
}
