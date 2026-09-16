export interface TaskEvent {
  taskId: string;
  stage?: string;
  event: string;
  createdAt: string;
  summary: string;
  data?: Record<string, unknown>;
}

export function taskArtifactRoot(taskId: string): string {
  if (!taskId) {
    throw new Error("taskId cannot be empty");
  }
  return `artifacts/tasks/${taskId}`;
}

export function taskArtifactPath(taskId: string, filename: string): string {
  if (!taskId) {
    throw new Error("taskId cannot be empty");
  }
  return `${taskArtifactRoot(taskId)}/${filename}`;
}
