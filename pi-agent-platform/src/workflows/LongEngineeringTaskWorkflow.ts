import { defineQuery, defineSignal, setHandler, condition, proxyActivities } from "@temporalio/workflow";
import type { ApprovalSignal, TaskInput, TaskStatus } from "./TaskWorkflowContract.js";
import { APPROVAL_SIGNAL_NAME, STATUS_QUERY_NAME } from "./TaskWorkflowContract.js";

// Define activity types locally to avoid importing from activities (which causes bundling issues)
interface ActivityTypes {
  createTaskActivity(input: { taskId: string; title: string; inputFile?: string; repo?: string; baseBranch?: string }): Promise<{ id: string }>;
  runStageActivity(taskId: string, stage: string, runtime: string, worktreePath?: string, context?: Record<string, unknown>): Promise<{ status: string; summary: string; usage?: { inputTokens?: number; outputTokens?: number } }>;
  prepareWorkspaceActivity(taskId: string, repo: string, baseBranch: string): Promise<{ worktreePath: string; branchName: string }>;
  runTestsActivity(taskId: string, worktreePath?: string): Promise<{ passed: boolean; failedTests: Array<{ name: string; message: string }>; logFile: string; commands: string[] }>;
  collectDiffActivity(taskId: string, worktreePath: string, artifactRoot: string): Promise<{ hasDiff: boolean; sizeBytes: number }>;
  publishFinalReportActivity(taskId: string): Promise<{ status: string; summary: string }>;
}

export function stageTerminalStatus(
  taskId: string,
  stage: string,
  result: { status: string; summary: string }
): TaskStatus | undefined {
  if (result.status === "succeeded") {
    return undefined;
  }

  return {
    taskId,
    status: result.status === "blocked" || result.status === "needs_input" ? "blocked" : "failed",
    stage,
    comment: result.summary,
  };
}

const { runStageActivity } = proxyActivities<ActivityTypes>({
  startToCloseTimeout: "30 minutes",
  retry: {
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

const { prepareWorkspaceActivity } = proxyActivities<ActivityTypes>({
  startToCloseTimeout: "5 minutes",
});

const { runTestsActivity } = proxyActivities<ActivityTypes>({
  startToCloseTimeout: "10 minutes",
});

const { collectDiffActivity } = proxyActivities<ActivityTypes>({
  startToCloseTimeout: "5 minutes",
});

const { publishFinalReportActivity } = proxyActivities<ActivityTypes>({
  startToCloseTimeout: "5 minutes",
});

const { createTaskActivity } = proxyActivities<ActivityTypes>({
  startToCloseTimeout: "1 minute",
});

// Signal and Query definitions
export const approvalSignal = defineSignal<[ApprovalSignal]>(APPROVAL_SIGNAL_NAME);
export const statusQuery = defineQuery<TaskStatus>(STATUS_QUERY_NAME);

export async function LongEngineeringTaskWorkflow(input: TaskInput): Promise<TaskStatus> {
  let currentStage = "";
  let workflowStatus = "running";
  let comment: string | undefined;

  setHandler(statusQuery, () => ({
    taskId: input.taskId,
    status: workflowStatus,
    stage: currentStage,
    comment,
  }));

  // Create task
  await createTaskActivity({
    taskId: input.taskId,
    title: input.title,
    inputFile: input.inputFile || undefined,
    repo: input.repo || undefined,
    baseBranch: input.baseBranch,
  });
  currentStage = "created";

  let worktreePath = "";
  if (input.repo) {
    currentStage = "prepare_workspace";
    const preparedWorkspace = await prepareWorkspaceActivity(input.taskId, input.repo, input.baseBranch);
    worktreePath = preparedWorkspace.worktreePath;
  }

  // Build model context from task input
  const modelContext: Record<string, unknown> = {};
  if (input.model) modelContext.model = input.model;
  if (input.provider) modelContext.provider = input.provider;

  // Stage 1: Normalize requirements
  currentStage = "normalize_requirements";
  const requirements = await runStageActivity(input.taskId, "normalize_requirements", input.runtime, worktreePath, modelContext);
  const requirementsTerminal = stageTerminalStatus(input.taskId, currentStage, requirements);
  if (requirementsTerminal) {
    workflowStatus = requirementsTerminal.status;
    comment = requirementsTerminal.comment;
    return requirementsTerminal;
  }

  // Approval: requirements
  currentStage = "waiting_for_requirements_approval";
  await waitForApproval("requirements");

  // Stage 2: Analyze requirements
  currentStage = "analyze_requirements";
  const analysis = await runStageActivity(input.taskId, "analyze_requirements", input.runtime, worktreePath, modelContext);
  const analysisTerminal = stageTerminalStatus(input.taskId, currentStage, analysis);
  if (analysisTerminal) {
    workflowStatus = analysisTerminal.status;
    comment = analysisTerminal.comment;
    return analysisTerminal;
  }

  // Stage 3: CodeGraph impact analysis
  currentStage = "codegraph_impact";
  const impact = await runStageActivity(input.taskId, "codegraph_impact", input.runtime, worktreePath, modelContext);
  const impactTerminal = stageTerminalStatus(input.taskId, currentStage, impact);
  if (impactTerminal) {
    workflowStatus = impactTerminal.status;
    comment = impactTerminal.comment;
    return impactTerminal;
  }

  // Stage 4: Write implementation plan
  currentStage = "write_implementation_plan";
  const plan = await runStageActivity(input.taskId, "write_implementation_plan", input.runtime, worktreePath, modelContext);
  const planTerminal = stageTerminalStatus(input.taskId, currentStage, plan);
  if (planTerminal) {
    workflowStatus = planTerminal.status;
    comment = planTerminal.comment;
    return planTerminal;
  }

  // Approval: plan
  currentStage = "waiting_for_plan_approval";
  await waitForApproval("plan");

  // Stage 6: Write tests
  currentStage = "write_tests";
  const tests = await runStageActivity(input.taskId, "write_tests", input.runtime, worktreePath, modelContext);
  const testsTerminal = stageTerminalStatus(input.taskId, currentStage, tests);
  if (testsTerminal) {
    workflowStatus = testsTerminal.status;
    comment = testsTerminal.comment;
    return testsTerminal;
  }

  // Stage 7: Implement code
  currentStage = "implement_code";
  const implementation = await runStageActivity(input.taskId, "implement_code", input.runtime, worktreePath, modelContext);
  const implementationTerminal = stageTerminalStatus(input.taskId, currentStage, implementation);
  if (implementationTerminal) {
    workflowStatus = implementationTerminal.status;
    comment = implementationTerminal.comment;
    return implementationTerminal;
  }

  // Collect diff after implementation
  currentStage = "collect_diff";
  const diffResult = await collectDiffActivity(
    input.taskId,
    worktreePath || input.repo || ".",
    `artifacts/tasks/${input.taskId}`
  );

  // Stage 8-10: Test and fix loop (max 3 attempts)
  currentStage = "testing";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const testResult = await runTestsActivity(input.taskId, worktreePath);
    if (testResult.passed) {
      break;
    }
    if (attempt === 3) {
      workflowStatus = "tests_failed_needs_human";
      currentStage = "fix_test_failures";
      return { taskId: input.taskId, status: "tests_failed_needs_human", stage: currentStage, comment: "Tests failed after 3 fix attempts" };
    }
    currentStage = `fix_test_failures_attempt_${attempt}`;
    // Pass test failure details to Pi so it knows what to fix
    const fixContext: Record<string, unknown> = {
      ...modelContext,
      attempt,
      failedTests: testResult.failedTests,
      testLogFile: testResult.logFile,
      testCommands: testResult.commands,
    };
    const fix = await runStageActivity(input.taskId, "fix_test_failures", input.runtime, worktreePath, fixContext);
    const fixTerminal = stageTerminalStatus(input.taskId, currentStage, fix);
    if (fixTerminal) {
      workflowStatus = fixTerminal.status;
      comment = fixTerminal.comment;
      return fixTerminal;
    }
  }

  // Stage 11: Review diff
  currentStage = "review_diff";
  const review = await runStageActivity(input.taskId, "review_diff", input.runtime, worktreePath, modelContext);
  const reviewTerminal = stageTerminalStatus(input.taskId, currentStage, review);
  if (reviewTerminal) {
    workflowStatus = reviewTerminal.status;
    comment = reviewTerminal.comment;
    return reviewTerminal;
  }

  // Stage 12: Publish final report
  currentStage = "publish_final_report";
  const report = await publishFinalReportActivity(input.taskId);
  const reportTerminal = stageTerminalStatus(input.taskId, currentStage, report);
  if (reportTerminal) {
    workflowStatus = reportTerminal.status;
    comment = reportTerminal.comment;
    return reportTerminal;
  }

  workflowStatus = "completed";
  currentStage = "completed";
  return { taskId: input.taskId, status: "completed" };
}

async function waitForApproval(stage: "requirements" | "plan" | "diff" | "pr"): Promise<void> {
  let approval: ApprovalSignal | undefined;
  setHandler(approvalSignal, (signal: ApprovalSignal) => {
    if (signal.stage === stage) {
      approval = signal;
    }
  });

  await condition(() => approval !== undefined);

  if (approval?.decision === "rejected") {
    throw new Error(`Approval rejected for stage: ${stage}. Reason: ${approval.comment || "No reason provided"}`);
  }
}
