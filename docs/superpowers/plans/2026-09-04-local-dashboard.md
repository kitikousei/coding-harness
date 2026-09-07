# Local Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local dashboard that monitors existing Temporal-backed pi-agent tasks, streams artifact logs, and submits approval signals from the browser.

**Architecture:** Add a small TypeScript dashboard subsystem under `pi-agent-platform/src/dashboard` using Node built-in HTTP/SSE and static assets. Keep Temporal communication behind a wrapper, keep artifact reading behind a task store, and normalize raw JSONL/stderr into one browser-friendly event model.

**Tech Stack:** TypeScript ESM, Node.js 22 built-in `http`/`fs`, Commander, `@temporalio/client`, Vitest, static HTML/CSS/JavaScript, Server-Sent Events.

**Spec:** `docs/superpowers/specs/2026-09-04-local-dashboard-design.md`

## Global Constraints

- First version observes existing workflows; it does not create workflows.
- First version supports existing approval gates: requirements and plan.
- First version uses no login, multi-user access control, tenant isolation, React, Vite, or persistent database.
- Default bind host is `127.0.0.1`; LAN access requires an explicit host option such as `0.0.0.0`.
- Artifact root defaults to `process.cwd()/artifacts/tasks`.
- Temporal address defaults to `TEMPORAL_ADDRESS` or `localhost:7233`.
- Use existing `@temporalio/client` dependency.
- Treat artifact files as append-only logs.
- Do not block agent execution on dashboard logging.
- Preserve existing CLI workflows.
- Current workspace has no usable git repository metadata; commit steps should be executed only in an environment where `git status --short` succeeds.

---

## File Structure

Create:

- `pi-agent-platform/src/dashboard/types.ts`: shared dashboard API types, stage list, approval-stage mapping.
- `pi-agent-platform/src/dashboard/event-normalizer.ts`: converts workflow JSONL, Pi SDK JSONL, and stderr lines into `DashboardEvent`.
- `pi-agent-platform/src/dashboard/task-store.ts`: lists task directories, artifact files, and normalized historical events.
- `pi-agent-platform/src/dashboard/temporal-client.ts`: wraps Temporal workflow status queries and approval signals.
- `pi-agent-platform/src/dashboard/event-stream.ts`: polls append-only task log files and emits SSE messages.
- `pi-agent-platform/src/dashboard/server.ts`: HTTP router, JSON endpoints, SSE endpoint, static file serving.
- `pi-agent-platform/src/dashboard/public/index.html`: dashboard shell.
- `pi-agent-platform/src/dashboard/public/styles.css`: operational dashboard styling.
- `pi-agent-platform/src/dashboard/public/app.js`: browser-side task selection, status polling, SSE logs, approval submission.
- `pi-agent-platform/src/cli/commands/dashboard.ts`: Commander command for launching the dashboard.
- `pi-agent-platform/src/workflows/TaskWorkflowContract.ts`: pure workflow contract constants and shared signal/query types.
- `pi-agent-platform/src/__tests__/dashboard/event-normalizer.test.ts`
- `pi-agent-platform/src/__tests__/dashboard/task-store.test.ts`
- `pi-agent-platform/src/__tests__/dashboard/temporal-client.test.ts`
- `pi-agent-platform/src/__tests__/dashboard/server.test.ts`
- `pi-agent-platform/src/__tests__/activities/task-event-activity.test.ts`

Modify:

- `pi-agent-platform/src/cli/index.ts`: register `dashboardCommand`.
- `pi-agent-platform/src/cli/commands/workflow.ts`: use shared workflow contract constants/types.
- `pi-agent-platform/src/cli/commands/approve.ts`: use shared workflow contract constants/types.
- `pi-agent-platform/src/activities/stage-activities.ts`: export `recordTaskEventActivity`.
- `pi-agent-platform/src/workflows/LongEngineeringTaskWorkflow.ts`: use shared workflow contract, call workflow event activity at orchestration boundaries.
- `pi-agent-platform/package.json`: add a `dashboard` script.
- `pi-agent-platform/README.md`: document the dashboard command and local workflow observation flow.

---

### Task 1: Dashboard Event Types And Normalization

**Files:**
- Create: `pi-agent-platform/src/dashboard/types.ts`
- Create: `pi-agent-platform/src/dashboard/event-normalizer.ts`
- Test: `pi-agent-platform/src/__tests__/dashboard/event-normalizer.test.ts`

**Interfaces:**
- Produces: `DashboardEvent`, `DashboardTaskSummary`, `DashboardTaskDetail`, `DashboardWorkflowStatus`, `ApprovalRequest`, `WORKFLOW_STAGES`, `approvalStageForWorkflowStage(stage: string): ApprovalRequest["stage"] | undefined`
- Produces: `normalizeJsonlLine(input: NormalizeJsonlLineInput): DashboardEvent | undefined`
- Produces: `normalizeStderrLine(input: NormalizeStderrLineInput): DashboardEvent | undefined`

- [ ] **Step 1: Write failing event normalizer tests**

Create `pi-agent-platform/src/__tests__/dashboard/event-normalizer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { approvalStageForWorkflowStage } from "../../dashboard/types.js";
import { normalizeJsonlLine, normalizeStderrLine } from "../../dashboard/event-normalizer.js";

describe("dashboard event normalization", () => {
  it("normalizes task workflow events from events.jsonl", () => {
    const event = normalizeJsonlLine({
      taskId: "TASK-1",
      file: "events.jsonl",
      lineNumber: 1,
      line: JSON.stringify({
        taskId: "TASK-1",
        stage: "normalize_requirements",
        event: "stage.started",
        createdAt: "2026-09-04T10:00:00.000Z",
        summary: "Stage started: normalize_requirements",
      }),
    });

    expect(event).toMatchObject({
      id: "events.jsonl:1",
      taskId: "TASK-1",
      source: "workflow",
      stage: "normalize_requirements",
      level: "info",
      event: "stage.started",
      createdAt: "2026-09-04T10:00:00.000Z",
      summary: "Stage started: normalize_requirements",
    });
  });

  it("summarizes Pi SDK tool execution start events", () => {
    const event = normalizeJsonlLine({
      taskId: "TASK-1",
      stage: "implement_code",
      file: "implement_code.events.jsonl",
      lineNumber: 3,
      line: JSON.stringify({
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "call-1",
        args: { command: "pnpm test" },
      }),
    });

    expect(event).toMatchObject({
      id: "implement_code.events.jsonl:3",
      source: "agent",
      stage: "implement_code",
      level: "info",
      event: "tool_execution_start",
      summary: "Tool started: bash",
    });
  });

  it("marks Pi SDK tool execution errors as error level", () => {
    const event = normalizeJsonlLine({
      taskId: "TASK-1",
      stage: "implement_code",
      file: "implement_code.events.jsonl",
      lineNumber: 4,
      line: JSON.stringify({
        type: "tool_execution_end",
        toolName: "bash",
        isError: true,
        result: { content: [{ text: "Command failed" }] },
      }),
    });

    expect(event).toMatchObject({
      level: "error",
      event: "tool_execution_end",
      summary: "Tool failed: bash",
    });
  });

  it("returns a warning event for malformed JSONL", () => {
    const event = normalizeJsonlLine({
      taskId: "TASK-1",
      file: "events.jsonl",
      lineNumber: 2,
      line: "{not-json",
    });

    expect(event).toMatchObject({
      source: "workflow",
      level: "warn",
      event: "log.parse_failed",
      summary: "Could not parse events.jsonl line 2",
    });
  });

  it("normalizes stderr log lines", () => {
    const event = normalizeStderrLine({
      taskId: "TASK-1",
      stage: "implement_code",
      file: "implement_code.stderr.log",
      lineNumber: 1,
      line: "fatal: command failed",
    });

    expect(event).toMatchObject({
      source: "stderr",
      stage: "implement_code",
      level: "error",
      event: "stderr.line",
      summary: "fatal: command failed",
    });
  });

  it("maps workflow wait stages to approval stages", () => {
    expect(approvalStageForWorkflowStage("waiting_for_requirements_approval")).toBe("requirements");
    expect(approvalStageForWorkflowStage("waiting_for_plan_approval")).toBe("plan");
    expect(approvalStageForWorkflowStage("implement_code")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard/event-normalizer.test.ts
```

Expected: FAIL because `dashboard/types.js` and `dashboard/event-normalizer.js` do not exist yet.

- [ ] **Step 3: Add dashboard types**

Create `pi-agent-platform/src/dashboard/types.ts`:

```ts
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
```

- [ ] **Step 4: Add event normalizer implementation**

Create `pi-agent-platform/src/dashboard/event-normalizer.ts`:

```ts
import type { DashboardEvent, DashboardEventLevel, DashboardEventSource } from "./types.js";

export interface NormalizeJsonlLineInput {
  taskId: string;
  file: string;
  lineNumber: number;
  line: string;
  stage?: string;
}

export interface NormalizeStderrLineInput {
  taskId: string;
  file: string;
  lineNumber: number;
  line: string;
  stage?: string;
}

export function normalizeJsonlLine(input: NormalizeJsonlLineInput): DashboardEvent | undefined {
  const line = input.line.trim();
  if (!line) return undefined;

  const source = sourceForFile(input.file);
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (source === "workflow") {
      return normalizeWorkflowEvent(input, raw);
    }
    return normalizeAgentEvent(input, raw);
  } catch {
    return {
      id: eventId(input.file, input.lineNumber),
      taskId: input.taskId,
      source,
      stage: input.stage,
      level: "warn",
      event: "log.parse_failed",
      createdAt: new Date().toISOString(),
      summary: `Could not parse ${input.file} line ${input.lineNumber}`,
      data: { line },
    };
  }
}

export function normalizeStderrLine(input: NormalizeStderrLineInput): DashboardEvent | undefined {
  const line = input.line.trimEnd();
  if (!line) return undefined;

  return {
    id: eventId(input.file, input.lineNumber),
    taskId: input.taskId,
    source: "stderr",
    stage: input.stage,
    level: stderrLevel(line),
    event: "stderr.line",
    createdAt: new Date().toISOString(),
    summary: line,
    data: { file: input.file, lineNumber: input.lineNumber },
  };
}

function normalizeWorkflowEvent(input: NormalizeJsonlLineInput, raw: Record<string, unknown>): DashboardEvent {
  const event = stringValue(raw.event) || "workflow.event";
  return {
    id: eventId(input.file, input.lineNumber),
    taskId: stringValue(raw.taskId) || input.taskId,
    source: "workflow",
    stage: stringValue(raw.stage) || input.stage,
    level: workflowLevel(event),
    event,
    createdAt: stringValue(raw.createdAt) || new Date().toISOString(),
    summary: stringValue(raw.summary) || event,
    data: raw,
  };
}

function normalizeAgentEvent(input: NormalizeJsonlLineInput, raw: Record<string, unknown>): DashboardEvent {
  const event = stringValue(raw.type) || "agent.event";
  return {
    id: eventId(input.file, input.lineNumber),
    taskId: input.taskId,
    source: "agent",
    stage: input.stage,
    level: agentLevel(raw),
    event,
    createdAt: new Date().toISOString(),
    summary: agentSummary(raw),
    data: raw,
  };
}

function sourceForFile(file: string): DashboardEventSource {
  return file === "events.jsonl" ? "workflow" : "agent";
}

function workflowLevel(event: string): DashboardEventLevel {
  if (event.includes("failed") || event.includes("blocked") || event.includes("rejected")) return "error";
  if (event.includes("waiting") || event.includes("needs_input")) return "warn";
  return "info";
}

function agentLevel(raw: Record<string, unknown>): DashboardEventLevel {
  if (raw.type === "tool_execution_end" && raw.isError === true) return "error";
  if (raw.type === "auto_retry_start" || raw.type === "compaction_start") return "warn";
  if (raw.type === "message_update") return "debug";
  return "info";
}

function stderrLevel(line: string): DashboardEventLevel {
  return /error|failed|fatal|exception/i.test(line) ? "error" : "warn";
}

function agentSummary(raw: Record<string, unknown>): string {
  const type = stringValue(raw.type) || "agent.event";
  const toolName = stringValue(raw.toolName);

  if (type === "tool_execution_start") return `Tool started: ${toolName || "unknown"}`;
  if (type === "tool_execution_end" && raw.isError === true) return `Tool failed: ${toolName || "unknown"}`;
  if (type === "tool_execution_end") return `Tool completed: ${toolName || "unknown"}`;
  if (type === "bash_execution_update") return stringValue(raw.delta) || "Bash output updated";
  if (type === "agent_settled") return "Agent settled";
  if (type === "turn_start") return "Turn started";
  if (type === "turn_end") return "Turn ended";

  if (type === "message_update") {
    const assistantEvent = raw.assistantMessageEvent as Record<string, unknown> | undefined;
    if (assistantEvent?.type === "text_delta") {
      return stringValue(assistantEvent.delta) || "Assistant text updated";
    }
  }

  return type;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function eventId(file: string, lineNumber: number): string {
  return `${file}:${lineNumber}`;
}
```

- [ ] **Step 5: Run the event normalizer tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard/event-normalizer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1 when git metadata is available**

Run:

```bash
git status --short
git add src/dashboard/types.ts src/dashboard/event-normalizer.ts src/__tests__/dashboard/event-normalizer.test.ts
git commit -m "feat: add dashboard event normalization"
```

Expected in the current workspace: `git status --short` fails because repository metadata is unavailable, so record that the commit was skipped.

---

### Task 2: Artifact Task Store

**Files:**
- Create: `pi-agent-platform/src/dashboard/task-store.ts`
- Test: `pi-agent-platform/src/__tests__/dashboard/task-store.test.ts`

**Interfaces:**
- Consumes: `DashboardTaskSummary`, `DashboardTaskDetail`, `DashboardEvent`
- Consumes: `normalizeJsonlLine(input)`, `normalizeStderrLine(input)`
- Produces: `class DashboardTaskStore`
- Produces: `listTasks(): Promise<DashboardTaskSummary[]>`
- Produces: `getTask(taskId: string): Promise<Omit<DashboardTaskDetail, "workflow" | "temporalAvailable">>`
- Produces: `readEvents(taskId: string, options?: ReadTaskEventsOptions): Promise<DashboardEvent[]>`
- Produces: `listEventFiles(taskId: string): Promise<TaskLogFile[]>`

- [ ] **Step 1: Write failing task store tests**

Create `pi-agent-platform/src/__tests__/dashboard/task-store.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { DashboardTaskStore } from "../../dashboard/task-store.js";

describe("DashboardTaskStore", () => {
  const root = resolve(process.cwd(), "test-dashboard-task-store-tmp");

  beforeAll(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(resolve(root, "TASK-1"), { recursive: true });
    await mkdir(resolve(root, "TASK-2"), { recursive: true });
    await writeFile(resolve(root, "TASK-1", "task.json"), JSON.stringify({ createdAt: "2026-09-04T10:00:00.000Z" }));
    await writeFile(resolve(root, "TASK-1", "events.jsonl"), [
      JSON.stringify({
        taskId: "TASK-1",
        event: "stage.started",
        stage: "normalize_requirements",
        createdAt: "2026-09-04T10:00:01.000Z",
        summary: "Stage started",
      }),
      "{bad-json",
    ].join("\n") + "\n");
    await writeFile(resolve(root, "TASK-1", "implement_code.events.jsonl"), JSON.stringify({
      type: "tool_execution_start",
      toolName: "bash",
    }) + "\n");
    await writeFile(resolve(root, "TASK-1", "implement_code.stderr.log"), "fatal: failed\n");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists task directories with default workflow ids", async () => {
    const store = new DashboardTaskStore(root);
    const tasks = await store.listTasks();

    expect(tasks.map((task) => task.taskId)).toEqual(["TASK-1", "TASK-2"]);
    expect(tasks[0]).toMatchObject({
      taskId: "TASK-1",
      workflowId: "pi-agent-TASK-1",
      artifactRoot: resolve(root, "TASK-1"),
      createdAt: "2026-09-04T10:00:00.000Z",
    });
  });

  it("returns artifact files for a task", async () => {
    const store = new DashboardTaskStore(root);
    const detail = await store.getTask("TASK-1");

    expect(detail.artifactFiles).toEqual([
      "events.jsonl",
      "implement_code.events.jsonl",
      "implement_code.stderr.log",
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
  });

  it("rejects unsafe task ids", async () => {
    const store = new DashboardTaskStore(root);
    await expect(store.getTask("../TASK-1")).rejects.toThrow("Invalid task id");
  });
});
```

- [ ] **Step 2: Run the failing task store tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard/task-store.test.ts
```

Expected: FAIL because `dashboard/task-store.js` does not exist yet.

- [ ] **Step 3: Implement artifact task store**

Create `pi-agent-platform/src/dashboard/task-store.ts`:

```ts
import { readdir, readFile, stat } from "fs/promises";
import { resolve, sep } from "path";
import type { DashboardEvent, DashboardTaskDetail, DashboardTaskSummary } from "./types.js";
import { normalizeJsonlLine, normalizeStderrLine } from "./event-normalizer.js";

export interface ReadTaskEventsOptions {
  limit?: number;
  source?: DashboardEvent["source"];
  stage?: string;
}

export interface TaskLogFile {
  file: string;
  fullPath: string;
  stage?: string;
  kind: "jsonl" | "stderr";
}

export class DashboardTaskStore {
  constructor(private readonly artifactRoot: string = resolve(process.cwd(), "artifacts/tasks")) {}

  async listTasks(): Promise<DashboardTaskSummary[]> {
    const entries = await readdir(this.artifactRoot, { withFileTypes: true }).catch(() => []);
    const tasks: DashboardTaskSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const taskId = entry.name;
      if (!isSafeTaskId(taskId)) continue;

      const taskDir = this.resolveTaskDir(taskId);
      const taskStat = await stat(taskDir);
      const createdAt = await this.readCreatedAt(taskId);
      tasks.push({
        taskId,
        workflowId: `pi-agent-${taskId}`,
        artifactRoot: taskDir,
        createdAt,
        updatedAt: taskStat.mtime.toISOString(),
      });
    }

    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getTask(taskId: string): Promise<Omit<DashboardTaskDetail, "workflow" | "temporalAvailable">> {
    const taskDir = this.resolveTaskDir(taskId);
    const taskStat = await stat(taskDir);
    const artifactFiles = await this.listArtifactFiles(taskId);
    return {
      taskId,
      workflowId: `pi-agent-${taskId}`,
      artifactRoot: taskDir,
      createdAt: await this.readCreatedAt(taskId),
      updatedAt: taskStat.mtime.toISOString(),
      artifactFiles,
    };
  }

  async listArtifactFiles(taskId: string): Promise<string[]> {
    const taskDir = this.resolveTaskDir(taskId);
    const entries = await readdir(taskDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  }

  async listEventFiles(taskId: string): Promise<TaskLogFile[]> {
    const taskDir = this.resolveTaskDir(taskId);
    const files = await this.listArtifactFiles(taskId);
    return files
      .filter((file) => file === "events.jsonl" || file.endsWith(".events.jsonl") || file.endsWith(".stderr.log"))
      .map((file) => ({
        file,
        fullPath: resolve(taskDir, file),
        stage: stageFromLogFile(file),
        kind: file.endsWith(".stderr.log") ? "stderr" : "jsonl",
      }));
  }

  async readEvents(taskId: string, options: ReadTaskEventsOptions = {}): Promise<DashboardEvent[]> {
    const limit = options.limit ?? 2000;
    const events: DashboardEvent[] = [];
    const files = await this.listEventFiles(taskId);

    for (const file of files) {
      const raw = await readFile(file.fullPath, "utf-8").catch(() => "");
      const lines = raw.split("\n");
      lines.forEach((line, index) => {
        const event = file.kind === "stderr"
          ? normalizeStderrLine({ taskId, file: file.file, stage: file.stage, lineNumber: index + 1, line })
          : normalizeJsonlLine({ taskId, file: file.file, stage: file.stage, lineNumber: index + 1, line });
        if (event) events.push(event);
      });
    }

    return events
      .filter((event) => !options.source || event.source === options.source)
      .filter((event) => !options.stage || event.stage === options.stage)
      .slice(-limit);
  }

  resolveTaskDir(taskId: string): string {
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

  private async readCreatedAt(taskId: string): Promise<string | undefined> {
    const raw = await readFile(resolve(this.resolveTaskDir(taskId), "task.json"), "utf-8").catch(() => "");
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as { createdAt?: unknown };
      return typeof parsed.createdAt === "string" ? parsed.createdAt : undefined;
    } catch {
      return undefined;
    }
  }
}

function isSafeTaskId(taskId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(taskId);
}

function stageFromLogFile(file: string): string | undefined {
  if (file === "events.jsonl") return undefined;
  if (file.endsWith(".events.jsonl")) return file.slice(0, -".events.jsonl".length);
  if (file.endsWith(".stderr.log")) return file.slice(0, -".stderr.log".length);
  return undefined;
}
```

- [ ] **Step 4: Run the task store tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard/task-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run Task 1 and Task 2 tests together**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard/event-normalizer.test.ts src/__tests__/dashboard/task-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2 when git metadata is available**

Run:

```bash
git status --short
git add src/dashboard/task-store.ts src/__tests__/dashboard/task-store.test.ts
git commit -m "feat: add dashboard artifact task store"
```

Expected in the current workspace: `git status --short` fails because repository metadata is unavailable, so record that the commit was skipped.

---

### Task 3: Temporal Workflow Contract And Dashboard Client

**Files:**
- Create: `pi-agent-platform/src/workflows/TaskWorkflowContract.ts`
- Create: `pi-agent-platform/src/dashboard/temporal-client.ts`
- Modify: `pi-agent-platform/src/workflows/LongEngineeringTaskWorkflow.ts`
- Modify: `pi-agent-platform/src/cli/commands/workflow.ts`
- Modify: `pi-agent-platform/src/cli/commands/approve.ts`
- Test: `pi-agent-platform/src/__tests__/dashboard/temporal-client.test.ts`
- Test: update `pi-agent-platform/src/__tests__/workflows/workflow-restart-recovery.test.ts`

**Interfaces:**
- Produces: `APPROVAL_SIGNAL_NAME = "approval"`
- Produces: `STATUS_QUERY_NAME = "status"`
- Produces: `ApprovalSignal`, `TaskStatus`
- Produces: `class DashboardTemporalClient`
- Produces: `getStatus(workflowId: string): Promise<DashboardWorkflowStatus>`
- Produces: `sendApproval(workflowId: string, request: ApprovalRequest): Promise<{ ok: true; signal: ApprovalSignal }>`

- [ ] **Step 1: Write failing Temporal client tests**

Create `pi-agent-platform/src/__tests__/dashboard/temporal-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { APPROVAL_SIGNAL_NAME, STATUS_QUERY_NAME } from "../../workflows/TaskWorkflowContract.js";
import { DashboardTemporalClient } from "../../dashboard/temporal-client.js";

describe("DashboardTemporalClient", () => {
  it("queries workflow status using the shared status query name", async () => {
    const handle = {
      query: vi.fn().mockResolvedValue({
        taskId: "TASK-1",
        status: "running",
        stage: "implement_code",
        comment: "working",
      }),
      describe: vi.fn().mockResolvedValue({ status: "RUNNING" }),
      signal: vi.fn(),
    };
    const client = {
      workflow: {
        getHandle: vi.fn().mockReturnValue(handle),
      },
    };

    const temporal = new DashboardTemporalClient(client as any);
    const status = await temporal.getStatus("pi-agent-TASK-1");

    expect(client.workflow.getHandle).toHaveBeenCalledWith("pi-agent-TASK-1");
    expect(handle.query).toHaveBeenCalledWith(STATUS_QUERY_NAME);
    expect(status).toEqual({
      workflowId: "pi-agent-TASK-1",
      taskId: "TASK-1",
      status: "running",
      stage: "implement_code",
      comment: "working",
      temporalStatus: "RUNNING",
      temporalAvailable: true,
    });
  });

  it("marks Temporal unavailable when status query fails", async () => {
    const handle = {
      query: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
      describe: vi.fn(),
      signal: vi.fn(),
    };
    const client = {
      workflow: {
        getHandle: vi.fn().mockReturnValue(handle),
      },
    };

    const temporal = new DashboardTemporalClient(client as any);
    const status = await temporal.getStatus("pi-agent-TASK-1");

    expect(status).toMatchObject({
      workflowId: "pi-agent-TASK-1",
      taskId: "TASK-1",
      status: "unavailable",
      temporalAvailable: false,
      comment: "connect ECONNREFUSED",
    });
  });

  it("sends approval signal with dashboard reviewer and server decidedAt", async () => {
    const handle = {
      query: vi.fn(),
      describe: vi.fn(),
      signal: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      workflow: {
        getHandle: vi.fn().mockReturnValue(handle),
      },
    };

    const temporal = new DashboardTemporalClient(client as any);
    const result = await temporal.sendApproval("pi-agent-TASK-1", {
      taskId: "TASK-1",
      stage: "plan",
      decision: "approved",
      comment: "Looks good",
    });

    expect(handle.signal).toHaveBeenCalledWith(APPROVAL_SIGNAL_NAME, {
      taskId: "TASK-1",
      stage: "plan",
      decision: "approved",
      comment: "Looks good",
      reviewer: "dashboard",
      decidedAt: expect.any(String),
    });
    expect(result.ok).toBe(true);
    expect(result.signal.reviewer).toBe("dashboard");
  });
});
```

- [ ] **Step 2: Run the failing Temporal client tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard/temporal-client.test.ts
```

Expected: FAIL because the contract and Temporal client files do not exist.

- [ ] **Step 3: Add shared workflow contract**

Create `pi-agent-platform/src/workflows/TaskWorkflowContract.ts`:

```ts
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
}
```

- [ ] **Step 4: Update workflow and CLI to use shared contract**

In `pi-agent-platform/src/workflows/LongEngineeringTaskWorkflow.ts`, replace local `TaskInput`, `ApprovalSignal`, and `TaskStatus` definitions with imports:

```ts
import type { ApprovalSignal, TaskInput, TaskStatus } from "./TaskWorkflowContract.js";
import { APPROVAL_SIGNAL_NAME, STATUS_QUERY_NAME } from "./TaskWorkflowContract.js";
```

Then update signal/query definitions:

```ts
export const approvalSignal = defineSignal<[ApprovalSignal]>(APPROVAL_SIGNAL_NAME);
export const statusQuery = defineQuery<TaskStatus>(STATUS_QUERY_NAME);
```

In `pi-agent-platform/src/cli/commands/workflow.ts`, replace the local `ApprovalSignal` interface and `approvalSignalName` constant with:

```ts
import type { ApprovalSignal } from "../../workflows/TaskWorkflowContract.js";
import { APPROVAL_SIGNAL_NAME } from "../../workflows/TaskWorkflowContract.js";

export const approvalSignalName = APPROVAL_SIGNAL_NAME;
```

In `pi-agent-platform/src/cli/commands/approve.ts`, keep importing `approvalSignalName` from `./workflow.js` so existing CLI behavior stays unchanged.

Also add the shared signal type and annotate the emitted signal:

```ts
import type { ApprovalSignal } from "../../workflows/TaskWorkflowContract.js";

const signal: ApprovalSignal = {
  taskId: opts.task,
  stage: opts.stage,
  decision: opts.decision,
  comment: opts.comment,
  reviewer: opts.reviewer,
  decidedAt: new Date().toISOString(),
};
```

- [ ] **Step 5: Add Temporal dashboard wrapper**

Create `pi-agent-platform/src/dashboard/temporal-client.ts`:

```ts
import { Client, Connection } from "@temporalio/client";
import type { ApprovalSignal, TaskStatus } from "../workflows/TaskWorkflowContract.js";
import { APPROVAL_SIGNAL_NAME, STATUS_QUERY_NAME } from "../workflows/TaskWorkflowContract.js";
import type { ApprovalRequest, DashboardWorkflowStatus } from "./types.js";

interface WorkflowHandleLike {
  query<T>(queryName: string): Promise<T>;
  describe(): Promise<{ status?: unknown }>;
  signal(signalName: string, payload: unknown): Promise<void>;
}

interface WorkflowClientLike {
  workflow: {
    getHandle(workflowId: string): WorkflowHandleLike;
  };
}

export class DashboardTemporalClient {
  constructor(private readonly client: WorkflowClientLike) {}

  static connect(address: string): DashboardTemporalClient {
    return new DashboardTemporalClient(new Client({
      connection: Connection.lazy({ address }),
    }));
  }

  async getStatus(workflowId: string): Promise<DashboardWorkflowStatus> {
    const taskId = taskIdFromWorkflowId(workflowId);
    try {
      const handle = this.client.workflow.getHandle(workflowId);
      const [status, description] = await Promise.all([
        handle.query<TaskStatus>(STATUS_QUERY_NAME),
        handle.describe().catch(() => ({})),
      ]);

      return {
        workflowId,
        taskId: status.taskId || taskId,
        status: status.status,
        stage: status.stage,
        comment: status.comment,
        temporalStatus: typeof description.status === "string" ? description.status : String(description.status ?? ""),
        temporalAvailable: true,
      };
    } catch (err) {
      return {
        workflowId,
        taskId,
        status: "unavailable",
        comment: err instanceof Error ? err.message : String(err),
        temporalAvailable: false,
      };
    }
  }

  async sendApproval(workflowId: string, request: ApprovalRequest): Promise<{ ok: true; signal: ApprovalSignal }> {
    const signal: ApprovalSignal = {
      taskId: request.taskId,
      stage: request.stage,
      decision: request.decision,
      comment: request.comment,
      reviewer: request.reviewer || "dashboard",
      decidedAt: new Date().toISOString(),
    };

    const handle = this.client.workflow.getHandle(workflowId);
    await handle.signal(APPROVAL_SIGNAL_NAME, signal);
    return { ok: true, signal };
  }
}

function taskIdFromWorkflowId(workflowId: string): string {
  return workflowId.startsWith("pi-agent-") ? workflowId.slice("pi-agent-".length) : workflowId;
}
```

- [ ] **Step 6: Update workflow contract tests**

In `pi-agent-platform/src/__tests__/workflows/workflow-restart-recovery.test.ts`, add imports:

```ts
import { APPROVAL_SIGNAL_NAME, STATUS_QUERY_NAME } from "../../workflows/TaskWorkflowContract.js";
```

Update the first test assertions:

```ts
expect(statusQuery.name).toBe(STATUS_QUERY_NAME);
expect(approvalSignal.name).toBe(APPROVAL_SIGNAL_NAME);
```

- [ ] **Step 7: Run Temporal client and workflow contract tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard/temporal-client.test.ts src/__tests__/workflows/workflow-restart-recovery.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3 when git metadata is available**

Run:

```bash
git status --short
git add src/workflows/TaskWorkflowContract.ts src/dashboard/temporal-client.ts src/workflows/LongEngineeringTaskWorkflow.ts src/cli/commands/workflow.ts src/cli/commands/approve.ts src/__tests__/dashboard/temporal-client.test.ts src/__tests__/workflows/workflow-restart-recovery.test.ts
git commit -m "feat: add dashboard Temporal workflow client"
```

Expected in the current workspace: `git status --short` fails because repository metadata is unavailable, so record that the commit was skipped.

---

### Task 4: Dashboard HTTP API And SSE Event Stream

**Files:**
- Create: `pi-agent-platform/src/dashboard/event-stream.ts`
- Create: `pi-agent-platform/src/dashboard/server.ts`
- Test: `pi-agent-platform/src/__tests__/dashboard/server.test.ts`

**Interfaces:**
- Consumes: `DashboardTaskStore`
- Consumes: `DashboardTemporalClient`
- Produces: `createDashboardRequestHandler(deps: DashboardServerDeps): RequestListener`
- Produces: `startDashboardServer(options: DashboardServerOptions): Promise<StartedDashboardServer>`
- Produces: `writeSseEvent(res: ServerResponse, event: string, data: unknown): void`

- [ ] **Step 1: Write failing API route tests**

Create `pi-agent-platform/src/__tests__/dashboard/server.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "http";
import { createDashboardRequestHandler } from "../../dashboard/server.js";

describe("dashboard HTTP server", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  async function start(deps: any): Promise<string> {
    server = createServer(createDashboardRequestHandler(deps));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected server address");
    return `http://127.0.0.1:${address.port}`;
  }

  it("returns task summaries", async () => {
    const baseUrl = await start({
      taskStore: {
        listTasks: vi.fn().mockResolvedValue([{ taskId: "TASK-1", workflowId: "pi-agent-TASK-1", artifactRoot: "/tmp/TASK-1", updatedAt: "2026-09-04T10:00:00.000Z" }]),
      },
      temporal: {},
    });

    const response = await fetch(`${baseUrl}/api/tasks`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tasks: [{ taskId: "TASK-1", workflowId: "pi-agent-TASK-1", artifactRoot: "/tmp/TASK-1", updatedAt: "2026-09-04T10:00:00.000Z" }],
    });
  });

  it("returns task detail with best-effort workflow status", async () => {
    const baseUrl = await start({
      taskStore: {
        getTask: vi.fn().mockResolvedValue({ taskId: "TASK-1", workflowId: "pi-agent-TASK-1", artifactRoot: "/tmp/TASK-1", updatedAt: "2026-09-04T10:00:00.000Z", artifactFiles: ["events.jsonl"] }),
      },
      temporal: {
        getStatus: vi.fn().mockResolvedValue({ workflowId: "pi-agent-TASK-1", taskId: "TASK-1", status: "running", stage: "implement_code", temporalAvailable: true }),
      },
    });

    const response = await fetch(`${baseUrl}/api/tasks/TASK-1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      taskId: "TASK-1",
      workflow: { status: "running", stage: "implement_code" },
      temporalAvailable: true,
    });
  });

  it("returns normalized events for a task", async () => {
    const events = [{ id: "events.jsonl:1", taskId: "TASK-1", source: "workflow", level: "info", event: "stage.started", createdAt: "2026-09-04T10:00:00.000Z", summary: "Stage started" }];
    const baseUrl = await start({
      taskStore: {
        readEvents: vi.fn().mockResolvedValue(events),
      },
      temporal: {},
    });

    const response = await fetch(`${baseUrl}/api/tasks/TASK-1/events?limit=1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events });
  });

  it("submits approval requests", async () => {
    const sendApproval = vi.fn().mockResolvedValue({ ok: true, signal: { taskId: "TASK-1", stage: "plan", decision: "approved", reviewer: "dashboard", decidedAt: "2026-09-04T10:00:00.000Z" } });
    const baseUrl = await start({
      taskStore: {},
      temporal: { sendApproval },
    });

    const response = await fetch(`${baseUrl}/api/workflows/pi-agent-TASK-1/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "TASK-1", stage: "plan", decision: "approved" }),
    });

    expect(response.status).toBe(200);
    expect(sendApproval).toHaveBeenCalledWith("pi-agent-TASK-1", { taskId: "TASK-1", stage: "plan", decision: "approved" });
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("returns 404 for unknown API routes", async () => {
    const baseUrl = await start({ taskStore: {}, temporal: {} });
    const response = await fetch(`${baseUrl}/api/missing`);
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the failing server tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard/server.test.ts
```

Expected: FAIL because `dashboard/server.js` does not exist yet.

- [ ] **Step 3: Implement SSE helpers**

Create `pi-agent-platform/src/dashboard/event-stream.ts`:

```ts
import type { ServerResponse } from "http";
import type { DashboardEvent } from "./types.js";

interface TaskEventReader {
  readEvents(taskId: string, options?: { limit?: number }): Promise<DashboardEvent[]>;
}

export function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function startTaskEventStream(
  taskStore: TaskEventReader,
  taskId: string,
  res: ServerResponse,
  pollIntervalMs = 1000
): () => void {
  const seen = new Set<string>();
  let closed = false;

  const sendNewEvents = async () => {
    if (closed) return;
    const events = await taskStore.readEvents(taskId, { limit: 5000 }).catch((err) => [{
      id: `stream-error:${Date.now()}`,
      taskId,
      source: "workflow" as const,
      level: "error" as const,
      event: "stream.error",
      createdAt: new Date().toISOString(),
      summary: err instanceof Error ? err.message : String(err),
    } satisfies DashboardEvent]);

    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      writeSseEvent(res, "event", event);
    }
  };

  const timer = setInterval(() => {
    void sendNewEvents();
    res.write(": heartbeat\n\n");
  }, pollIntervalMs);

  void sendNewEvents();

  return () => {
    closed = true;
    clearInterval(timer);
  };
}
```

- [ ] **Step 4: Implement HTTP server router**

Create `pi-agent-platform/src/dashboard/server.ts`:

```ts
import { createServer, type IncomingMessage, type RequestListener, type ServerResponse } from "http";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { dirname, extname, resolve } from "path";
import { fileURLToPath } from "url";
import { DashboardTaskStore } from "./task-store.js";
import { DashboardTemporalClient } from "./temporal-client.js";
import { startTaskEventStream } from "./event-stream.js";

export interface DashboardServerOptions {
  host: string;
  port: number;
  artifactRoot: string;
  temporalAddress: string;
}

export interface DashboardServerDeps {
  taskStore: Pick<DashboardTaskStore, "listTasks" | "getTask" | "readEvents">;
  temporal: Pick<DashboardTemporalClient, "getStatus" | "sendApproval">;
  publicDir?: string;
  streamPollIntervalMs?: number;
}

export interface StartedDashboardServer {
  url: string;
  close(): Promise<void>;
}

export function createDashboardRequestHandler(deps: DashboardServerDeps): RequestListener {
  const publicDir = deps.publicDir ?? resolve(dirname(fileURLToPath(import.meta.url)), "public");

  return (req, res) => {
    void routeRequest(req, res, deps, publicDir);
  };
}

export async function startDashboardServer(options: DashboardServerOptions): Promise<StartedDashboardServer> {
  const taskStore = new DashboardTaskStore(options.artifactRoot);
  const temporal = DashboardTemporalClient.connect(options.temporalAddress);
  const server = createServer(createDashboardRequestHandler({ taskStore, temporal }));

  await new Promise<void>((resolveListen) => server.listen(options.port, options.host, () => resolveListen()));

  return {
    url: `http://${options.host}:${options.port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

async function routeRequest(req: IncomingMessage, res: ServerResponse, deps: DashboardServerDeps, publicDir: string): Promise<void> {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;

  try {
    if (method === "GET" && path === "/api/tasks") {
      return sendJson(res, 200, { tasks: await deps.taskStore.listTasks() });
    }

    const taskDetailMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (method === "GET" && taskDetailMatch) {
      const taskId = decodeURIComponent(taskDetailMatch[1]);
      const detail = await deps.taskStore.getTask(taskId);
      const workflow = await deps.temporal.getStatus(detail.workflowId);
      return sendJson(res, 200, { ...detail, workflow, temporalAvailable: workflow.temporalAvailable });
    }

    const taskEventsMatch = path.match(/^\/api\/tasks\/([^/]+)\/events$/);
    if (method === "GET" && taskEventsMatch) {
      const taskId = decodeURIComponent(taskEventsMatch[1]);
      const limit = Number(url.searchParams.get("limit") || "2000");
      const source = url.searchParams.get("source") || undefined;
      const stage = url.searchParams.get("stage") || undefined;
      const events = await deps.taskStore.readEvents(taskId, { limit, source: source as any, stage });
      return sendJson(res, 200, { events });
    }

    const streamMatch = path.match(/^\/api\/tasks\/([^/]+)\/stream$/);
    if (method === "GET" && streamMatch) {
      const taskId = decodeURIComponent(streamMatch[1]);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const stop = startTaskEventStream(deps.taskStore, taskId, res, deps.streamPollIntervalMs);
      req.on("close", stop);
      return;
    }

    const statusMatch = path.match(/^\/api\/workflows\/([^/]+)\/status$/);
    if (method === "GET" && statusMatch) {
      const workflowId = decodeURIComponent(statusMatch[1]);
      return sendJson(res, 200, await deps.temporal.getStatus(workflowId));
    }

    const approvalMatch = path.match(/^\/api\/workflows\/([^/]+)\/approval$/);
    if (method === "POST" && approvalMatch) {
      const workflowId = decodeURIComponent(approvalMatch[1]);
      const body = await readJsonBody(req);
      return sendJson(res, 200, await deps.temporal.sendApproval(workflowId, body as any));
    }

    if (method === "GET" && !path.startsWith("/api/")) {
      return serveStatic(publicDir, path === "/" ? "/index.html" : path, res);
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, statusCode: number, value: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function serveStatic(publicDir: string, path: string, res: ServerResponse): Promise<void> {
  const fullPath = resolve(publicDir, "." + path);
  if (!fullPath.startsWith(resolve(publicDir))) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  const fileStat = await stat(fullPath).catch(() => undefined);
  if (!fileStat?.isFile()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  res.writeHead(200, { "content-type": contentType(fullPath) });
  createReadStream(fullPath).pipe(res);
}

function contentType(path: string): string {
  if (extname(path) === ".html") return "text/html; charset=utf-8";
  if (extname(path) === ".css") return "text/css; charset=utf-8";
  if (extname(path) === ".js") return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}
```

- [ ] **Step 5: Run server tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard/server.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run dashboard backend tests together**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4 when git metadata is available**

Run:

```bash
git status --short
git add src/dashboard/event-stream.ts src/dashboard/server.ts src/__tests__/dashboard/server.test.ts
git commit -m "feat: add dashboard HTTP and SSE API"
```

Expected in the current workspace: `git status --short` fails because repository metadata is unavailable, so record that the commit was skipped.

---

### Task 5: Static Dashboard UI And CLI Command

**Files:**
- Create: `pi-agent-platform/src/dashboard/public/index.html`
- Create: `pi-agent-platform/src/dashboard/public/styles.css`
- Create: `pi-agent-platform/src/dashboard/public/app.js`
- Create: `pi-agent-platform/src/cli/commands/dashboard.ts`
- Modify: `pi-agent-platform/src/cli/index.ts`
- Modify: `pi-agent-platform/package.json`

**Interfaces:**
- Consumes: `/api/tasks`
- Consumes: `/api/tasks/:taskId`
- Consumes: `/api/tasks/:taskId/stream`
- Consumes: `/api/workflows/:workflowId/status`
- Consumes: `/api/workflows/:workflowId/approval`
- Produces: CLI command `pnpm pi-agent-platform dashboard --port 8787`
- Produces: package script `pnpm dashboard`

- [ ] **Step 1: Add the static HTML shell**

Create `pi-agent-platform/src/dashboard/public/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pi Agent Dashboard</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <div class="app-shell">
      <aside class="task-rail">
        <div class="rail-header">
          <h1>Pi Agent</h1>
          <button id="refreshTasks" type="button">Refresh</button>
        </div>
        <div id="taskList" class="task-list"></div>
      </aside>

      <main class="task-main">
        <header class="task-header">
          <div>
            <div id="selectedTask" class="task-title">No task selected</div>
            <div id="workflowLine" class="muted"></div>
          </div>
          <div id="statusBadge" class="status-badge">idle</div>
        </header>

        <section id="progress" class="progress-row"></section>

        <section id="approvalPanel" class="approval-panel hidden">
          <div>
            <h2 id="approvalTitle">Approval</h2>
            <p id="approvalSummary" class="muted"></p>
          </div>
          <textarea id="approvalComment" rows="3" aria-label="Approval comment"></textarea>
          <div class="approval-actions">
            <button id="approveButton" class="primary" type="button">Approve</button>
            <button id="rejectButton" class="danger" type="button">Reject</button>
          </div>
          <div id="approvalError" class="error-line"></div>
        </section>

        <section class="toolbar">
          <select id="sourceFilter">
            <option value="">All sources</option>
            <option value="workflow">Workflow</option>
            <option value="agent">Agent</option>
            <option value="stderr">stderr</option>
          </select>
          <label><input id="errorsOnly" type="checkbox"> Errors only</label>
          <button id="clearLogs" type="button">Clear View</button>
        </section>

        <section id="logList" class="log-list"></section>
      </main>
    </div>
    <script src="/app.js" type="module"></script>
  </body>
</html>
```

- [ ] **Step 2: Add static CSS**

Create `pi-agent-platform/src/dashboard/public/styles.css`:

```css
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --ink: #1f2933;
  --muted: #687382;
  --line: #d8dde5;
  --accent: #176f7a;
  --accent-soft: #d9eef0;
  --danger: #b3261e;
  --warning: #8a5a00;
  --ok: #247a3f;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
}

button,
select,
textarea {
  font: inherit;
}

button {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--ink);
  padding: 7px 10px;
  cursor: pointer;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

button.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: white;
}

.app-shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  min-height: 100vh;
}

.task-rail {
  border-right: 1px solid var(--line);
  background: var(--panel);
  padding: 16px;
}

.rail-header,
.task-header,
.approval-actions,
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.rail-header h1 {
  font-size: 18px;
  margin: 0;
}

.task-list {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.task-item {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  background: #fbfcfd;
  text-align: left;
  width: 100%;
}

.task-item.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.task-main {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  gap: 12px;
  padding: 16px;
  min-width: 0;
}

.task-header,
.approval-panel,
.toolbar,
.log-list,
.progress-row {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.task-header,
.approval-panel,
.toolbar {
  padding: 12px;
}

.task-title {
  font-size: 18px;
  font-weight: 650;
}

.muted {
  color: var(--muted);
  font-size: 13px;
}

.status-badge {
  border-radius: 999px;
  padding: 5px 10px;
  background: #e7ebf0;
  font-size: 13px;
  min-width: 82px;
  text-align: center;
}

.progress-row {
  display: flex;
  gap: 6px;
  padding: 10px;
  overflow-x: auto;
}

.stage-pill {
  flex: 0 0 auto;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 5px 8px;
  font-size: 12px;
  white-space: nowrap;
  background: #f8fafc;
}

.stage-pill.completed {
  background: #e1f3e8;
  border-color: #a9d9b9;
}

.stage-pill.running {
  background: var(--accent-soft);
  border-color: var(--accent);
}

.stage-pill.waiting {
  background: #fff1cc;
  border-color: #d8a700;
}

.stage-pill.failed {
  background: #fde5e2;
  border-color: #e0a19b;
}

.approval-panel {
  display: grid;
  gap: 10px;
}

.approval-panel textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px;
}

.hidden {
  display: none;
}

.error-line {
  color: var(--danger);
  font-size: 13px;
}

.toolbar {
  justify-content: flex-start;
}

.log-list {
  overflow: auto;
  min-height: 360px;
  padding: 0;
}

.log-row {
  display: grid;
  grid-template-columns: 150px 88px 140px minmax(0, 1fr);
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid #eef1f4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.log-row.error {
  background: #fff3f1;
}

.log-row.warn {
  background: #fff9e8;
}

.log-summary {
  overflow-wrap: anywhere;
}

@media (max-width: 820px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .task-rail {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .log-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Add browser app logic**

Create `pi-agent-platform/src/dashboard/public/app.js`:

```js
const stages = [
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
];

const approvalStages = {
  waiting_for_requirements_approval: "requirements",
  waiting_for_plan_approval: "plan",
};

let selectedTask = undefined;
let workflow = undefined;
let events = [];
let stream = undefined;
let statusTimer = undefined;

const taskList = document.querySelector("#taskList");
const selectedTaskEl = document.querySelector("#selectedTask");
const workflowLine = document.querySelector("#workflowLine");
const statusBadge = document.querySelector("#statusBadge");
const progress = document.querySelector("#progress");
const approvalPanel = document.querySelector("#approvalPanel");
const approvalTitle = document.querySelector("#approvalTitle");
const approvalSummary = document.querySelector("#approvalSummary");
const approvalComment = document.querySelector("#approvalComment");
const approvalError = document.querySelector("#approvalError");
const logList = document.querySelector("#logList");
const sourceFilter = document.querySelector("#sourceFilter");
const errorsOnly = document.querySelector("#errorsOnly");

document.querySelector("#refreshTasks").addEventListener("click", () => void loadTasks());
document.querySelector("#clearLogs").addEventListener("click", () => {
  events = [];
  renderLogs();
});
document.querySelector("#approveButton").addEventListener("click", () => void submitApproval("approved"));
document.querySelector("#rejectButton").addEventListener("click", () => void submitApproval("rejected"));
sourceFilter.addEventListener("change", renderLogs);
errorsOnly.addEventListener("change", renderLogs);

void loadTasks();

async function loadTasks() {
  const response = await fetch("/api/tasks");
  const data = await response.json();
  renderTasks(data.tasks || []);
  if (!selectedTask && data.tasks?.[0]) {
    await selectTask(data.tasks[0]);
  }
}

function renderTasks(tasks) {
  taskList.replaceChildren(...tasks.map((task) => {
    const button = document.createElement("button");
    button.className = `task-item${selectedTask?.taskId === task.taskId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<strong>${escapeHtml(task.taskId)}</strong><div class="muted">${escapeHtml(task.updatedAt || "")}</div>`;
    button.addEventListener("click", () => void selectTask(task));
    return button;
  }));
}

async function selectTask(task) {
  selectedTask = task;
  events = [];
  workflow = undefined;
  if (stream) stream.close();
  if (statusTimer) clearInterval(statusTimer);

  selectedTaskEl.textContent = task.taskId;
  workflowLine.textContent = task.workflowId;
  await refreshStatus();
  openStream(task.taskId);
  statusTimer = setInterval(() => void refreshStatus(), 2000);
  await loadTasks();
}

async function refreshStatus() {
  if (!selectedTask) return;
  const response = await fetch(`/api/workflows/${encodeURIComponent(selectedTask.workflowId)}/status`);
  workflow = await response.json();
  statusBadge.textContent = workflow.status || "unknown";
  workflowLine.textContent = `${selectedTask.workflowId}${workflow.stage ? ` / ${workflow.stage}` : ""}`;
  renderProgress();
  renderApproval();
}

function openStream(taskId) {
  stream = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/stream`);
  stream.addEventListener("event", (message) => {
    events.push(JSON.parse(message.data));
    if (events.length > 3000) events = events.slice(-3000);
    renderLogs();
  });
  stream.onerror = () => {
    statusBadge.textContent = "reconnecting";
  };
}

function renderProgress() {
  const current = workflow?.stage;
  const currentIndex = stages.indexOf(current);
  const failed = workflow?.status && !["running", "completed", "unavailable"].includes(workflow.status);

  progress.replaceChildren(...stages.map((stage, index) => {
    const el = document.createElement("div");
    let state = "pending";
    if (workflow?.status === "completed") state = "completed";
    else if (index < currentIndex) state = "completed";
    else if (stage === current && failed) state = "failed";
    else if (stage === current && approvalStages[stage]) state = "waiting";
    else if (stage === current) state = "running";
    el.className = `stage-pill ${state}`;
    el.textContent = stage;
    return el;
  }));
}

function renderApproval() {
  const stage = workflow?.stage;
  const approvalStage = approvalStages[stage];
  if (!approvalStage || !selectedTask) {
    approvalPanel.classList.add("hidden");
    return;
  }

  approvalPanel.classList.remove("hidden");
  approvalTitle.textContent = `Approval: ${approvalStage}`;
  approvalSummary.textContent = workflow?.comment || `Workflow is waiting for ${approvalStage} approval.`;
  approvalError.textContent = "";
}

async function submitApproval(decision) {
  if (!selectedTask || !workflow?.stage) return;
  const approvalStage = approvalStages[workflow.stage];
  if (!approvalStage) return;

  approvalError.textContent = "";
  const response = await fetch(`/api/workflows/${encodeURIComponent(selectedTask.workflowId)}/approval`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: selectedTask.taskId,
      stage: approvalStage,
      decision,
      comment: approvalComment.value,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    approvalError.textContent = error.error || response.statusText;
    return;
  }

  approvalComment.value = "";
  await refreshStatus();
}

function renderLogs() {
  const source = sourceFilter.value;
  const onlyErrors = errorsOnly.checked;
  const visible = events
    .filter((event) => !source || event.source === source)
    .filter((event) => !onlyErrors || event.level === "error")
    .slice(-1000);

  logList.replaceChildren(...visible.map((event) => {
    const row = document.createElement("div");
    row.className = `log-row ${event.level}`;
    row.innerHTML = [
      `<span>${escapeHtml(event.createdAt || "")}</span>`,
      `<span>${escapeHtml(event.level)}</span>`,
      `<span>${escapeHtml(event.stage || event.source)}</span>`,
      `<span class="log-summary">${escapeHtml(event.summary || event.event)}</span>`,
    ].join("");
    return row;
  }));
  logList.scrollTop = logList.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
```

- [ ] **Step 4: Add CLI command**

Create `pi-agent-platform/src/cli/commands/dashboard.ts`:

```ts
import type { Command } from "commander";
import { resolve } from "path";
import { startDashboardServer } from "../../dashboard/server.js";

export function dashboardCommand(program: Command) {
  program
    .command("dashboard")
    .description("Start the local dashboard for observing existing Temporal workflows")
    .option("--port <port>", "Port to listen on", "8787")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--artifact-root <path>", "Task artifact root", resolve(process.cwd(), "artifacts/tasks"))
    .option("--temporal-address <address>", "Temporal address", process.env.TEMPORAL_ADDRESS || "localhost:7233")
    .action(async (opts: any) => {
      const server = await startDashboardServer({
        host: opts.host,
        port: Number(opts.port),
        artifactRoot: resolve(process.cwd(), opts.artifactRoot),
        temporalAddress: opts.temporalAddress,
      });

      console.log(`Pi Agent dashboard: ${server.url}`);
      console.log(`Artifacts: ${resolve(process.cwd(), opts.artifactRoot)}`);
      console.log(`Temporal: ${opts.temporalAddress}`);
    });
}
```

Modify `pi-agent-platform/src/cli/index.ts`:

```ts
import { dashboardCommand } from "./commands/dashboard.js";
```

Register after `approveCommand(program);`:

```ts
dashboardCommand(program);
```

- [ ] **Step 5: Add package script**

Modify `pi-agent-platform/package.json` scripts:

```json
"dashboard": "tsx src/cli/index.ts dashboard"
```

Keep the existing `pi-agent-platform` script unchanged.

- [ ] **Step 6: Run typecheck through build**

Run:

```bash
cd pi-agent-platform
pnpm build
```

Expected: PASS.

- [ ] **Step 7: Smoke-test static file route**

Run:

```bash
cd pi-agent-platform
pnpm pi-agent-platform dashboard --port 8787
```

Expected output includes:

```text
Pi Agent dashboard: http://127.0.0.1:8787
```

Open `http://127.0.0.1:8787` in a browser and confirm the page shows the task rail and main dashboard shell. Stop the command with `Ctrl-C` after verification.

- [ ] **Step 8: Commit Task 5 when git metadata is available**

Run:

```bash
git status --short
git add src/dashboard/public/index.html src/dashboard/public/styles.css src/dashboard/public/app.js src/cli/commands/dashboard.ts src/cli/index.ts package.json
git commit -m "feat: add local dashboard UI command"
```

Expected in the current workspace: `git status --short` fails because repository metadata is unavailable, so record that the commit was skipped.

---

### Task 6: Workflow-Level Event Logging Activity

**Files:**
- Modify: `pi-agent-platform/src/activities/stage-activities.ts`
- Modify: `pi-agent-platform/src/workflows/LongEngineeringTaskWorkflow.ts`
- Test: `pi-agent-platform/src/__tests__/activities/task-event-activity.test.ts`
- Test: update `pi-agent-platform/src/__tests__/workflows/workflow-restart-recovery.test.ts`

**Interfaces:**
- Consumes: `TaskEvent` from `artifacts/TaskArtifactPaths.ts`
- Produces: `recordTaskEventActivity(taskId: string, event: RecordTaskEventInput): Promise<{ recorded: boolean; error?: string }>`
- Produces workflow events: `workflow.started`, `workflow.stage.started`, `workflow.stage.succeeded`, `workflow.stage.failed`, `workflow.stage.blocked`, `workflow.approval.waiting`, `workflow.approval.approved`, `workflow.approval.rejected`, `workflow.completed`

- [ ] **Step 1: Write failing activity test**

Create `pi-agent-platform/src/__tests__/activities/task-event-activity.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, rm } from "fs/promises";
import { resolve } from "path";

describe("recordTaskEventActivity", () => {
  const taskId = "TASK-LOG-1";
  const taskDir = resolve(process.cwd(), `artifacts/tasks/${taskId}`);

  beforeAll(async () => {
    await rm(taskDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await rm(taskDir, { recursive: true, force: true });
  });

  it("appends workflow events without throwing", async () => {
    const { recordTaskEventActivity } = await import("../../activities/stage-activities.js");

    const result = await recordTaskEventActivity(taskId, {
      stage: "implement_code",
      event: "workflow.stage.started",
      summary: "Workflow stage started: implement_code",
      data: { runtime: "mock" },
    });

    expect(result).toEqual({ recorded: true });

    const raw = await readFile(resolve(taskDir, "events.jsonl"), "utf-8");
    const event = JSON.parse(raw.trim());
    expect(event).toMatchObject({
      taskId,
      stage: "implement_code",
      event: "workflow.stage.started",
      summary: "Workflow stage started: implement_code",
      data: { runtime: "mock" },
    });
    expect(event.createdAt).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 2: Run the failing activity test**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/activities/task-event-activity.test.ts
```

Expected: FAIL because `recordTaskEventActivity` is not exported.

- [ ] **Step 3: Add activity implementation**

Modify `pi-agent-platform/src/activities/stage-activities.ts`:

```ts
import type { TaskEvent } from "../artifacts/TaskArtifactPaths.js";
```

Add near the other activity exports:

```ts
export type RecordTaskEventInput = Omit<TaskEvent, "taskId" | "createdAt">;

export async function recordTaskEventActivity(
  taskId: string,
  event: RecordTaskEventInput
): Promise<{ recorded: boolean; error?: string }> {
  try {
    const artifactStore = new LocalArtifactStore();
    await artifactStore.appendEvent(taskId, {
      ...event,
      taskId,
      createdAt: new Date().toISOString(),
    });
    return { recorded: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Failed to record task event for ${taskId}: ${message}`);
    return { recorded: false, error: message };
  }
}
```

Because `src/cli/worker.ts` registers `import * as activities from "../activities/stage-activities.js"`, this exported function becomes available to Temporal workers without changing `worker.ts`.

- [ ] **Step 4: Run activity test**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/activities/task-event-activity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Instrument workflow with event activity**

Modify `pi-agent-platform/src/workflows/LongEngineeringTaskWorkflow.ts`.

Add the activity type:

```ts
recordTaskEventActivity(taskId: string, event: {
  stage?: string;
  event: string;
  summary: string;
  data?: Record<string, unknown>;
}): Promise<{ recorded: boolean; error?: string }>;
```

Add a proxy:

```ts
const { recordTaskEventActivity } = proxyActivities<ActivityTypes>({
  startToCloseTimeout: "1 minute",
});
```

Inside `LongEngineeringTaskWorkflow`, add a small helper after the `statusQuery` handler:

```ts
const recordWorkflowEvent = async (
  stage: string | undefined,
  event: string,
  summary: string,
  data?: Record<string, unknown>
) => {
  await recordTaskEventActivity(input.taskId, { stage, event, summary, data });
};
```

Call it at workflow start:

```ts
await recordWorkflowEvent(undefined, "workflow.started", `Workflow started: ${input.title}`, {
  runtime: input.runtime,
  repo: input.repo,
  baseBranch: input.baseBranch,
});
```

For each stage, prefer a local helper to keep repeated logging consistent:

```ts
const runLoggedStage = async (
  stage: string,
  context?: Record<string, unknown>
): Promise<TaskStatus | undefined> => {
  currentStage = stage;
  await recordWorkflowEvent(stage, "workflow.stage.started", `Workflow stage started: ${stage}`);
  const result = await runStageActivity(input.taskId, stage, input.runtime, context);
  const terminal = stageTerminalStatus(input.taskId, stage, result);
  const event = result.status === "succeeded"
    ? "workflow.stage.succeeded"
    : result.status === "blocked" || result.status === "needs_input"
      ? "workflow.stage.blocked"
      : "workflow.stage.failed";

  await recordWorkflowEvent(stage, event, result.summary, { status: result.status });

  if (terminal) {
    workflowStatus = terminal.status;
    comment = terminal.comment;
  }
  return terminal;
};
```

Use `runLoggedStage("normalize_requirements")`, `runLoggedStage("analyze_requirements")`, `runLoggedStage("codegraph_impact")`, `runLoggedStage("write_implementation_plan")`, `runLoggedStage("write_tests")`, `runLoggedStage("implement_code")`, `runLoggedStage("fix_test_failures", { attempt })`, and `runLoggedStage("review_diff")` in place of the current repeated `currentStage` + `runStageActivity` + `stageTerminalStatus` blocks.

For non-agent activities, record the same orchestration events directly:

```ts
currentStage = "prepare_workspace";
await recordWorkflowEvent(currentStage, "workflow.stage.started", "Workflow stage started: prepare_workspace");
const workspace = await prepareWorkspaceActivity(input.taskId, input.repo, input.baseBranch);
await recordWorkflowEvent(currentStage, "workflow.stage.succeeded", "Workspace prepared", workspace);

currentStage = "collect_diff";
await recordWorkflowEvent(currentStage, "workflow.stage.started", "Workflow stage started: collect_diff");
const diffResult = await collectDiffActivity(
  input.taskId,
  input.repo,
  `artifacts/tasks/${input.taskId}`
);
await recordWorkflowEvent(currentStage, "workflow.stage.succeeded", "Diff collected", diffResult);

currentStage = "testing";
await recordWorkflowEvent(currentStage, "workflow.stage.started", "Workflow stage started: testing");
for (let attempt = 1; attempt <= 3; attempt++) {
  const testResult = await runTestsActivity(input.taskId);
  await recordWorkflowEvent(currentStage, testResult.passed ? "workflow.stage.succeeded" : "workflow.stage.failed", `Test attempt ${attempt} ${testResult.passed ? "passed" : "failed"}`, { attempt, passed: testResult.passed });
  if (testResult.passed) break;
  if (attempt === 3) {
    workflowStatus = "tests_failed_needs_human";
    currentStage = "fix_test_failures";
    await recordWorkflowEvent(currentStage, "workflow.stage.blocked", "Tests failed after 3 fix attempts");
    return { taskId: input.taskId, status: "tests_failed_needs_human", stage: currentStage, comment: "Tests failed after 3 fix attempts" };
  }
  const fixTerminal = await runLoggedStage("fix_test_failures", { attempt });
  if (fixTerminal) return fixTerminal;
}

currentStage = "publish_final_report";
await recordWorkflowEvent(currentStage, "workflow.stage.started", "Workflow stage started: publish_final_report");
const report = await publishFinalReportActivity(input.taskId);
const reportTerminal = stageTerminalStatus(input.taskId, currentStage, report);
await recordWorkflowEvent(currentStage, reportTerminal ? "workflow.stage.failed" : "workflow.stage.succeeded", report.summary, { status: report.status });
if (reportTerminal) {
  workflowStatus = reportTerminal.status;
  comment = reportTerminal.comment;
  return reportTerminal;
}
```

Keep `review_diff` as a `runLoggedStage("review_diff")` call before the publish-final-report block.

For approvals, change `waitForApproval` to accept `taskId` and record the decision:

```ts
async function waitForApproval(taskId: string, stage: "requirements" | "plan" | "diff" | "pr"): Promise<void> {
  let approval: ApprovalSignal | undefined;
  setHandler(approvalSignal, (signal: ApprovalSignal) => {
    if (signal.stage === stage) {
      approval = signal;
    }
  });

  await recordTaskEventActivity(taskId, {
    stage,
    event: "workflow.approval.waiting",
    summary: `Workflow waiting for ${stage} approval`,
  });

  await condition(() => approval !== undefined);

  await recordTaskEventActivity(taskId, {
    stage,
    event: approval!.decision === "approved" ? "workflow.approval.approved" : "workflow.approval.rejected",
    summary: `${stage} approval ${approval!.decision} by ${approval!.reviewer}`,
    data: {
      reviewer: approval!.reviewer,
      comment: approval!.comment,
      decidedAt: approval!.decidedAt,
    },
  });

  if (approval?.decision === "rejected") {
    throw new Error(`Approval rejected for stage: ${stage}. Reason: ${approval.comment || "No reason provided"}`);
  }
}
```

Update the call sites:

```ts
currentStage = "waiting_for_requirements_approval";
await waitForApproval(input.taskId, "requirements");

currentStage = "waiting_for_plan_approval";
await waitForApproval(input.taskId, "plan");
```

At successful workflow completion, record:

```ts
await recordWorkflowEvent("completed", "workflow.completed", "Workflow completed");
```

- [ ] **Step 6: Update workflow tests for shared signal/query names**

In `pi-agent-platform/src/__tests__/workflows/workflow-restart-recovery.test.ts`, keep the existing restart-recovery assertions and add a shape assertion for the approval event data:

```ts
const approvalEvent = {
  stage: signal.stage,
  event: "workflow.approval.approved",
  summary: `${signal.stage} approval approved by ${signal.reviewer}`,
  data: {
    reviewer: signal.reviewer,
    comment: signal.comment,
    decidedAt: signal.decidedAt,
  },
};

expect(approvalEvent.data.reviewer).toBe("admin");
```

- [ ] **Step 7: Run workflow and activity tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/activities/task-event-activity.test.ts src/__tests__/workflows
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6 when git metadata is available**

Run:

```bash
git status --short
git add src/activities/stage-activities.ts src/workflows/LongEngineeringTaskWorkflow.ts src/__tests__/activities/task-event-activity.test.ts src/__tests__/workflows/workflow-restart-recovery.test.ts
git commit -m "feat: record workflow progress events"
```

Expected in the current workspace: `git status --short` fails because repository metadata is unavailable, so record that the commit was skipped.

---

### Task 7: Documentation And End-To-End Verification

**Files:**
- Modify: `pi-agent-platform/README.md`

**Interfaces:**
- Consumes: dashboard command from Task 5.
- Consumes: workflow event logging from Task 6.
- Produces: documented local dashboard usage and manual verification steps.

- [ ] **Step 1: Update README dashboard section**

In `pi-agent-platform/README.md`, add this section after the Temporal Worker instructions:

```md
### Local Dashboard

The local dashboard observes existing artifact-backed Temporal workflows and submits approval signals.

```bash
# Terminal 1: start Temporal dev server
temporal server start-dev --db-filename /tmp/pi-agent-temporal-dev.db

# Terminal 2: start worker
pnpm worker

# Terminal 3: start dashboard
pnpm pi-agent-platform dashboard --port 8787
```

Open `http://127.0.0.1:8787`.

The dashboard lists tasks from `artifacts/tasks`, maps each task to workflow id `pi-agent-<taskId>`, streams workflow and agent logs, and shows approval controls while the workflow is waiting at requirements or plan approval.

For LAN access on a trusted network:

```bash
pnpm pi-agent-platform dashboard --host 0.0.0.0 --port 8787
```
```

- [ ] **Step 2: Run all focused dashboard tests**

Run:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard src/__tests__/activities/task-event-activity.test.ts src/__tests__/workflows
```

Expected: PASS.

- [ ] **Step 3: Run full automated verification**

Run:

```bash
cd pi-agent-platform
pnpm test
pnpm build
```

Expected: PASS for both commands.

- [ ] **Step 4: Manual local dashboard verification**

Run these commands in separate terminals:

```bash
cd pi-agent-platform
temporal server start-dev --db-filename /tmp/pi-agent-temporal-dev.db
```

```bash
cd pi-agent-platform
pnpm worker
```

```bash
cd pi-agent-platform
pnpm pi-agent-platform workflow start --task DASHBOARD-SMOKE-001 --title "Dashboard smoke" --runtime mock
```

```bash
cd pi-agent-platform
pnpm pi-agent-platform dashboard --port 8787
```

Open `http://127.0.0.1:8787` and verify:

- task `DASHBOARD-SMOKE-001` appears in the task list
- status updates from Temporal when the workflow is reachable
- workflow and agent logs appear in the log list
- requirements approval panel appears at `waiting_for_requirements_approval`
- approving requirements moves the workflow forward
- plan approval panel appears at `waiting_for_plan_approval`
- approving plan moves the workflow forward
- stopping Temporal still leaves local artifact logs visible

- [ ] **Step 5: Commit Task 7 when git metadata is available**

Run:

```bash
git status --short
git add README.md
git commit -m "docs: document local dashboard workflow"
```

Expected in the current workspace: `git status --short` fails because repository metadata is unavailable, so record that the commit was skipped.

---

## Final Verification

- [ ] Run focused tests:

```bash
cd pi-agent-platform
pnpm exec vitest run src/__tests__/dashboard src/__tests__/activities/task-event-activity.test.ts src/__tests__/workflows
```

- [ ] Run the full suite:

```bash
cd pi-agent-platform
pnpm test
```

- [ ] Run TypeScript build:

```bash
cd pi-agent-platform
pnpm build
```

- [ ] Start the dashboard:

```bash
cd pi-agent-platform
pnpm pi-agent-platform dashboard --port 8787
```

- [ ] Verify the page at `http://127.0.0.1:8787`.

- [ ] Confirm whether commits were skipped because `git status --short` fails in this workspace.
