export interface StageResult {
  taskId: string;
  stage: string;
  status: "succeeded" | "failed" | "blocked" | "needs_input";
  summary: string;
  outputArtifacts: string[];
  error?: {
    type: string;
    message: string;
    retryable: boolean;
  };
}
