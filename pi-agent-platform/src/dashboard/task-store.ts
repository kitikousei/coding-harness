import type { Dirent } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import { resolve, sep } from "path";
import type { DashboardEvent, DashboardTaskDetail, DashboardTaskSummary } from "./types.js";
import type { WorkflowCostSummary } from "../cost/CostTracker.js";
import { normalizeJsonlLine, normalizeStderrLine, normalizeProgressLine } from "./event-normalizer.js";

export interface ReadTaskEventsOptions {
  limit?: number;
  source?: DashboardEvent["source"];
  stage?: string;
}

export interface TaskLogFile {
  file: string;
  fullPath: string;
  stage?: string;
  kind: "jsonl" | "stderr" | "progress";
}

export class DashboardTaskStore {
  constructor(private readonly artifactRoot: string = resolve(process.cwd(), "artifacts/tasks")) {}

  async listTasks(): Promise<DashboardTaskSummary[]> {
    const entries = await this.readTaskDirectories();
    const tasks: DashboardTaskSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const taskId = entry.name;
      if (!isSafeTaskId(taskId)) continue;

      const taskDir = this.resolveTaskDir(taskId);
      const metadata = await this.readTaskMetadata(taskId);
      const taskStat = await stat(taskDir);

      tasks.push({
        taskId,
        workflowId: `pi-agent-${taskId}`,
        artifactRoot: taskDir,
        createdAt: metadata?.createdAt,
        updatedAt: taskStat.mtime.toISOString(),
      });
    }

    return tasks.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.taskId.localeCompare(b.taskId));
  }

  async getTask(taskId: string): Promise<Omit<DashboardTaskDetail, "workflow" | "temporalAvailable">> {
    const taskDir = this.resolveTaskDir(taskId);
    const taskStat = await stat(taskDir);

    return {
      taskId,
      workflowId: `pi-agent-${taskId}`,
      artifactRoot: taskDir,
      createdAt: (await this.readTaskMetadata(taskId))?.createdAt,
      updatedAt: taskStat.mtime.toISOString(),
      artifactFiles: await this.listArtifactFiles(taskId),
    };
  }

  async readEvents(taskId: string, options: ReadTaskEventsOptions = {}): Promise<DashboardEvent[]> {
    const limit = options.limit ?? 2000;
    const events: DashboardEvent[] = [];

    for (const file of await this.listEventFiles(taskId)) {
      const raw = await readFile(file.fullPath, "utf-8").catch(() => "");
      const lines = raw.split("\n");

      for (const [index, line] of lines.entries()) {
        const event =
          file.kind === "stderr"
            ? normalizeStderrLine({
                taskId,
                file: file.file,
                stage: file.stage,
                lineNumber: index + 1,
                line,
              })
            : file.kind === "progress"
            ? normalizeProgressLine({
                taskId,
                file: file.file,
                stage: file.stage,
                lineNumber: index + 1,
                line,
              })
            : normalizeJsonlLine({
                taskId,
                file: file.file,
                stage: file.stage,
                lineNumber: index + 1,
                line,
              });

        if (!event) continue;
        if (options.source && event.source !== options.source) continue;
        if (options.stage && event.stage !== options.stage) continue;
        events.push(event);
      }
    }

    if (limit <= 0) return [];
    return events.slice(-limit);
  }

  async readCostSummary(taskId: string): Promise<WorkflowCostSummary | undefined> {
    const raw = await readFile(resolve(this.resolveTaskDir(taskId), "cost-summary.json"), "utf-8").catch(() => "");
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as WorkflowCostSummary;
    } catch {
      return undefined;
    }
  }

  async listEventFiles(taskId: string): Promise<TaskLogFile[]> {
    const taskDir = this.resolveTaskDir(taskId);
    const files = await this.listArtifactFiles(taskId);

    return files
      .filter((file) =>
        file === "events.jsonl" ||
        file.endsWith(".events.jsonl") ||
        file.endsWith(".stderr.log") ||
        file.endsWith(".progress.log")
      )
      .map((file) => ({
        file,
        fullPath: resolve(taskDir, file),
        stage: stageFromLogFile(file),
        kind: file.endsWith(".stderr.log") ? "stderr"
          : file.endsWith(".progress.log") ? "progress"
          : "jsonl",
      }));
  }

  private async readTaskDirectories(): Promise<Dirent<string>[]> {
    return readdir(this.artifactRoot, { withFileTypes: true }).catch(() => []);
  }

  private async listArtifactFiles(taskId: string): Promise<string[]> {
    const taskDir = this.resolveTaskDir(taskId);
    const entries = await readdir(taskDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  }

  private async readTaskMetadata(taskId: string): Promise<{ createdAt?: string } | undefined> {
    const raw = await readFile(resolve(this.resolveTaskDir(taskId), "task.json"), "utf-8").catch(() => "");
    if (!raw) return undefined;

    try {
      const parsed = JSON.parse(raw) as { createdAt?: unknown };
      return typeof parsed.createdAt === "string" ? { createdAt: parsed.createdAt } : undefined;
    } catch {
      return undefined;
    }
  }

  private resolveTaskDir(taskId: string): string {
    if (!isSafeTaskId(taskId)) {
      throw new Error(`Invalid task id: ${taskId}`);
    }

    const root = resolve(this.artifactRoot);
    const taskDir = resolve(root, taskId);
    if (taskDir !== root && !taskDir.startsWith(root + sep)) {
      throw new Error(`Invalid task id: ${taskId}`);
    }

    return taskDir;
  }
}

function isSafeTaskId(taskId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(taskId);
}

function stageFromLogFile(file: string): string | undefined {
  if (file === "events.jsonl") return undefined;
  if (file.endsWith(".events.jsonl")) return file.slice(0, -".events.jsonl".length);
  if (file.endsWith(".stdout.jsonl")) return file.slice(0, -".stdout.jsonl".length);
  if (file.endsWith(".stderr.log")) return file.slice(0, -".stderr.log".length);
  if (file.endsWith(".progress.log")) return file.slice(0, -".progress.log".length);
  return undefined;
}
