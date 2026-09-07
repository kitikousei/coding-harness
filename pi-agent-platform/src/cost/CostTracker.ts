import type { ArtifactStore } from "../artifacts/LocalArtifactStore.js";

/**
 * Per-stage token/cost record written to <stage>.cost.json after each stage completes.
 */
export interface StageCostEntry {
  stage: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model?: string;
  startedAt: string;
  completedAt: string;
}

/**
 * Aggregated cost summary for an entire workflow, updated after each stage.
 * Written to cost-summary.json in the task artifact directory.
 */
export interface WorkflowCostSummary {
  taskId: string;
  stages: StageCostEntry[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  updatedAt: string;
}

const COST_SUMMARY_FILE = "cost-summary.json";

function stageCostFile(stage: string): string {
  return `${stage}.cost.json`;
}

export class CostTracker {
  constructor(private readonly artifactStore: ArtifactStore) {}

  /**
   * Record a stage's token usage after it completes.
   * Writes a per-stage cost file and updates the aggregated cost-summary.json.
   */
  async recordStageCost(taskId: string, entry: StageCostEntry): Promise<void> {
    // Write per-stage cost file
    await this.artifactStore.writeJson(taskId, stageCostFile(entry.stage), entry);

    // Read existing summary, update, write back
    const summary = await this.readCostSummary(taskId).catch(() =>
      emptySummary(taskId)
    );

    // Replace or append stage entry
    const existingIdx = summary.stages.findIndex(
      (s) => s.stage === entry.stage
    );
    if (existingIdx >= 0) {
      summary.stages[existingIdx] = entry;
    } else {
      summary.stages.push(entry);
    }

    // Recalculate totals from all stage entries
    summary.totals = summary.stages.reduce(
      (acc, s) => ({
        inputTokens: acc.inputTokens + s.inputTokens,
        outputTokens: acc.outputTokens + s.outputTokens,
        totalTokens: acc.totalTokens + s.totalTokens,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    );
    summary.updatedAt = new Date().toISOString();

    await this.artifactStore.writeJson(taskId, COST_SUMMARY_FILE, summary);
  }

  /**
   * Read the aggregated cost summary for a task.
   */
  async readCostSummary(taskId: string): Promise<WorkflowCostSummary> {
    return this.artifactStore.readJson<WorkflowCostSummary>(
      taskId,
      COST_SUMMARY_FILE
    );
  }
}

function emptySummary(taskId: string): WorkflowCostSummary {
  return {
    taskId,
    stages: [],
    totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    updatedAt: new Date().toISOString(),
  };
}