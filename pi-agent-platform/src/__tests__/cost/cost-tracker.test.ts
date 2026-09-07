import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile } from "fs/promises";
import { resolve } from "path";
import { CostTracker } from "../../cost/CostTracker.js";
import { LocalArtifactStore } from "../../artifacts/LocalArtifactStore.js";

describe("CostTracker", () => {
  const testRoot = resolve(process.cwd(), "test-cost-tracker-tmp");
  let store: LocalArtifactStore;
  let tracker: CostTracker;

  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    store = new LocalArtifactStore(testRoot);
    tracker = new CostTracker(store);
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it("records a single stage cost and writes per-stage and summary files", async () => {
    await store.ensureTask("TASK-1");

    await tracker.recordStageCost("TASK-1", {
      stage: "normalize_requirements",
      inputTokens: 12000,
      outputTokens: 8000,
      totalTokens: 20000,
      model: "claude-3-5-sonnet-20241022",
      startedAt: "2026-09-06T10:00:00.000Z",
      completedAt: "2026-09-06T10:01:00.000Z",
    });

    // Per-stage file exists
    const stageRaw = await readFile(
      resolve(testRoot, "artifacts/tasks/TASK-1/normalize_requirements.cost.json"),
      "utf-8"
    );
    const stageData = JSON.parse(stageRaw);
    expect(stageData.stage).toBe("normalize_requirements");
    expect(stageData.inputTokens).toBe(12000);
    expect(stageData.outputTokens).toBe(8000);
    expect(stageData.totalTokens).toBe(20000);

    // Summary file exists
    const summary = await tracker.readCostSummary("TASK-1");
    expect(summary.taskId).toBe("TASK-1");
    expect(summary.stages).toHaveLength(1);
    expect(summary.totals.inputTokens).toBe(12000);
    expect(summary.totals.outputTokens).toBe(8000);
    expect(summary.totals.totalTokens).toBe(20000);
  });

  it("accumulates multiple stages in the summary", async () => {
    await store.ensureTask("TASK-2");

    await tracker.recordStageCost("TASK-2", {
      stage: "normalize_requirements",
      inputTokens: 5000,
      outputTokens: 3000,
      totalTokens: 8000,
      startedAt: "2026-09-06T10:00:00.000Z",
      completedAt: "2026-09-06T10:01:00.000Z",
    });

    await tracker.recordStageCost("TASK-2", {
      stage: "implement_code",
      inputTokens: 25000,
      outputTokens: 15000,
      totalTokens: 40000,
      model: "gpt-4o",
      startedAt: "2026-09-06T10:02:00.000Z",
      completedAt: "2026-09-06T10:05:00.000Z",
    });

    const summary = await tracker.readCostSummary("TASK-2");
    expect(summary.stages).toHaveLength(2);
    expect(summary.totals.inputTokens).toBe(30000);
    expect(summary.totals.outputTokens).toBe(18000);
    expect(summary.totals.totalTokens).toBe(48000);
  });

  it("replaces an existing stage entry when re-recording", async () => {
    await store.ensureTask("TASK-3");

    await tracker.recordStageCost("TASK-3", {
      stage: "write_tests",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      startedAt: "2026-09-06T10:00:00.000Z",
      completedAt: "2026-09-06T10:01:00.000Z",
    });

    await tracker.recordStageCost("TASK-3", {
      stage: "write_tests",
      inputTokens: 2000,
      outputTokens: 1000,
      totalTokens: 3000,
      startedAt: "2026-09-06T10:00:00.000Z",
      completedAt: "2026-09-06T10:02:00.000Z",
    });

    const summary = await tracker.readCostSummary("TASK-3");
    expect(summary.stages).toHaveLength(1);
    expect(summary.totals.totalTokens).toBe(3000);
  });

  it("returns empty summary for task with no recorded stages", async () => {
    await store.ensureTask("TASK-EMPTY");
    await expect(tracker.readCostSummary("TASK-EMPTY")).rejects.toThrow();
  });
});