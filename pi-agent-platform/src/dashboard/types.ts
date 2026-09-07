export type DashboardEventSource = "workflow" | "agent" | "stderr";
export type DashboardEventLevel = "debug" | "info" | "warn" | "error";
export type ApprovalDecision = "approved" | "rejected";
export type ApprovalStage = "requirements" | "plan" | "diff" | "pr";

export interface DashboardEvent {
  id: string;
  taskId: string;
  source: DashboardEventSource;
  stage?: string;
  level: DashboardEventLevel;
  event: string;
  createdAt: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface DashboardTaskSummary {
  taskId: string;
  workflowId: string;
  artifactRoot: string;
  createdAt?: string;
  updatedAt: string;
}

export interface DashboardTaskDetail extends DashboardTaskSummary {
  artifactFiles: string[];
  workflow?: DashboardWorkflowStatus;
  temporalAvailable: boolean;
}

export interface DashboardWorkflowStatus {
  workflowId: string;
  taskId: string;
  status: string;
  stage?: string;
  comment?: string;
  temporalStatus?: string;
  temporalAvailable: boolean;
}

export interface ApprovalRequest {
  taskId: string;
  stage: ApprovalStage;
  decision: ApprovalDecision;
  comment?: string;
  reviewer?: string;
}

export const WORKFLOW_STAGES = [
  "normalize_requirements",
  "waiting_for_requirements_approval",
  "analyze_requirements",
  "codegraph_impact",
  "write_implementation_plan",
  "waiting_for_plan_approval",
  "prepare_workspace",
  "write_tests",
  "implement_code",
  "collect_diff",
  "testing",
  "fix_test_failures_attempt_1",
  "fix_test_failures_attempt_2",
  "fix_test_failures",
  "review_diff",
  "publish_final_report",
  "completed",
] as const;

export function approvalStageForWorkflowStage(stage: string): ApprovalStage | undefined {
  if (stage === "waiting_for_requirements_approval") return "requirements";
  if (stage === "waiting_for_plan_approval") return "plan";
  return undefined;
}
