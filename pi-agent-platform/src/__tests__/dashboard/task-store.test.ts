import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, rm, utimes, writeFile } from "fs/promises";
import { resolve } from "path";
import { DashboardTaskStore } from "../../dashboard/task-store.js";

describe("DashboardTaskStore", () => {
  const root = resolve(process.cwd(), "test-dashboard-task-store-tmp");

  beforeAll(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(resolve(root, "TASK-1"), { recursive: true });
    await mkdir(resolve(root, "TASK-2"), { recursive: true });
    await writeFile(resolve(root, "README"), "dashboard notes\n");
    await writeFile(resolve(root, "TASK-1", "task.json"), JSON.stringify({ createdAt: "2026-09-04T10:00:00.000Z" }));
    await writeFile(
      resolve(root, "TASK-1", "events.jsonl"),
      [
        JSON.stringify({
          taskId: "TASK-1",
          event: "stage.started",
          stage: "normalize_requirements",
          createdAt: "2026-09-04T10:00:01.000Z",
          summary: "Stage started",
        }),
        "{bad-json",
      ].join("\n") + "\n"
    );
    await writeFile(
      resolve(root, "TASK-1", "implement_code.events.jsonl"),
      JSON.stringify({
        type: "tool_execution_start",
        toolName: "bash",
      }) + "\n"
    );
    await writeFile(
      resolve(root, "TASK-1", "normalize_requirements.stdout.jsonl"),
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "reading requirements" },
      }) + "\n"
    );
    await writeFile(resolve(root, "TASK-1", "implement_code.stderr.log"), "fatal: failed\n");
    await writeFile(
      resolve(root, "TASK-1", "cost-summary.json"),
      JSON.stringify({
        taskId: "TASK-1",
        stages: [
          {
            stage: "normalize_requirements",
            inputTokens: 12000,
            outputTokens: 8000,
            totalTokens: 20000,
            startedAt: "2026-09-04T10:00:00.000Z",
            completedAt: "2026-09-04T10:01:00.000Z",
          },
        ],
        totals: { inputTokens: 12000, outputTokens: 8000, totalTokens: 20000 },
        updatedAt: "2026-09-04T10:01:00.000Z",
      })
    );

    await utimes(resolve(root, "TASK-1"), new Date("2026-09-04T10:00:00.000Z"), new Date("2026-09-04T10:00:00.000Z"));
    await utimes(resolve(root, "TASK-2"), new Date("2026-09-04T11:00:00.000Z"), new Date("2026-09-04T11:00:00.000Z"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists task directories with default workflow ids", async () => {
    const store = new DashboardTaskStore(root);
    const tasks = await store.listTasks();

    expect(tasks.map((task) => task.taskId)).toEqual(["TASK-2", "TASK-1"]);
    expect(tasks[1]).toMatchObject({
      taskId: "TASK-1",
      workflowId: "pi-agent-TASK-1",
      artifactRoot: resolve(root, "TASK-1"),
      createdAt: "2026-09-04T10:00:00.000Z",
    });
  });

  it("skips safe-named files in the artifact root", async () => {
    const store = new DashboardTaskStore(root);
    const tasks = await store.listTasks();

    expect(tasks.map((task) => task.taskId)).not.toContain("README");
  });

  it("returns artifact files for a task", async () => {
    const store = new DashboardTaskStore(root);
    const detail = await store.getTask("TASK-1");

    expect(detail.artifactFiles).toEqual([
      "cost-summary.json",
      "events.jsonl",
      "implement_code.events.jsonl",
      "implement_code.stderr.log",
      "normalize_requirements.stdout.jsonl",
      "task.json",
    ]);
  });

  it("reads normalized events from workflow, agent, and stderr files", async () => {
    const store = new DashboardTaskStore(root);
    const events = await store.readEvents("TASK-1");

    expect(events.map((event) => event.source)).toEqual(["workflow", "workflow", "agent", "stderr"]);
    expect(events.some((event) => event.event === "log.parse_failed")).toBe(true);
    expect(events.some((event) => event.summary === "Tool started: bash")).toBe(true);
    expect(events.some((event) => event.summary === "fatal: failed")).toBe(true);
    expect(events.some((event) => event.summary === "reading requirements")).toBe(false);
  });

  it("reads cost summary for a task", async () => {
    const store = new DashboardTaskStore(root);
    const summary = await store.readCostSummary("TASK-1");

    expect(summary).toBeDefined();
    expect(summary!.taskId).toBe("TASK-1");
    expect(summary!.stages).toHaveLength(1);
    expect(summary!.stages[0].stage).toBe("normalize_requirements");
    expect(summary!.stages[0].inputTokens).toBe(12000);
    expect(summary!.totals.totalTokens).toBe(20000);
  });

  it("returns undefined for missing cost summary", async () => {
    const store = new DashboardTaskStore(root);
    const summary = await store.readCostSummary("TASK-2");
    expect(summary).toBeUndefined();
  });

  it("rejects unsafe task ids", async () => {
    const store = new DashboardTaskStore(root);
    await expect(store.getTask("../TASK-1")).rejects.toThrow("Invalid task id");
  });
});
