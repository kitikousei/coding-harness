export const APPROVAL_SIGNAL_NAME = "approval";
export const STATUS_QUERY_NAME = "status";

export interface TaskInput {
  taskId: string;
  title: string;
  repo: string;
  baseBranch: string;
  inputFile: string;
  approvalPolicy: "requirements_and_plan";
  testPolicy: "unit_tests_required";
  runtime: "mock" | "pi" | "pi-cli" | "codex";
  model?: string;
  provider?: string;
}

export interface ApprovalSignal {
  taskId: string;
  stage: "requirements" | "plan" | "diff" | "pr";
  decision: "approved" | "rejected";
  comment?: string;
  reviewer: string;
  decidedAt: string;
}

export interface TaskStatus {
  taskId: string;
  status: string;
  stage?: string;
  comment?: string;
  artifacts?: { name: string; size: number; path: string }[];
  approvalContext?: {
    stage: string;
    artifacts: { name: string; size: number; path: string }[];
    summary: string;
  };
}
