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

interface DashboardTemporalClientOptions {
  statusTimeoutMs?: number;
}

export class DashboardTemporalClient {
  constructor(
    private readonly client: WorkflowClientLike,
    private readonly options: DashboardTemporalClientOptions = {}
  ) {}

  static connect(address?: string): DashboardTemporalClient {
    return new DashboardTemporalClient(new Client({
      connection: Connection.lazy({ address: address || process.env.TEMPORAL_ADDRESS || "localhost:7233" }),
    }));
  }

  async getStatus(workflowId: string): Promise<DashboardWorkflowStatus> {
    const taskId = taskIdFromWorkflowId(workflowId);
    const timeoutMs = this.options.statusTimeoutMs ?? 3000;
    try {
      const handle = this.client.workflow.getHandle(workflowId);
      const [status, description] = await Promise.all([
        withTimeout(handle.query<TaskStatus>(STATUS_QUERY_NAME), timeoutMs, `Temporal status query timed out after ${timeoutMs}ms`),
        withTimeout(Promise.resolve(handle.describe()), timeoutMs, `Temporal describe timed out after ${timeoutMs}ms`).catch((): { status?: unknown } => ({})),
      ]);

      const temporalStatus = formatTemporalStatus(description.status);

      return {
        workflowId,
        taskId: status.taskId || taskId,
        status: dashboardStatus(status.status, temporalStatus),
        stage: status.stage,
        comment: status.comment,
        temporalStatus,
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatTemporalStatus(status: unknown): string {
  if (typeof status === "string") return status;
  if (status && typeof status === "object" && "name" in status) {
    const name = (status as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return status === undefined ? "" : JSON.stringify(status);
}

function dashboardStatus(workflowStatus: string, temporalStatus: string): string {
  const normalized = temporalStatus.replaceAll("_", "").toUpperCase();
  if (normalized === "CANCELED" || normalized === "CANCELLED") return "canceled";
  if (normalized === "COMPLETED") return "completed";
  if (normalized === "FAILED") return "failed";
  if (normalized === "TERMINATED") return "terminated";
  if (normalized === "TIMEDOUT") return "timed_out";
  return workflowStatus;
}
