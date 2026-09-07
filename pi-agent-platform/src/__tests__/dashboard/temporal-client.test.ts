import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_SIGNAL_NAME, STATUS_QUERY_NAME } from "../../workflows/TaskWorkflowContract.js";
import { DashboardTemporalClient } from "../../dashboard/temporal-client.js";

const temporalClientMocks = vi.hoisted(() => {
  const lazy = vi.fn((options: { address: string }) => options);
  const Client = vi.fn().mockImplementation((config: unknown) => ({
    workflow: {
      getHandle: vi.fn(),
    },
    config,
  }));

  return { lazy, Client };
});

vi.mock("@temporalio/client", () => ({
  Connection: {
    lazy: temporalClientMocks.lazy,
  },
  Client: temporalClientMocks.Client,
}));

describe("DashboardTemporalClient", () => {
  afterEach(() => {
    delete process.env.TEMPORAL_ADDRESS;
    temporalClientMocks.lazy.mockClear();
    temporalClientMocks.Client.mockClear();
  });

  it("connect applies explicit address, env fallback, and localhost default", () => {
    DashboardTemporalClient.connect("temporal.example:7233");

    process.env.TEMPORAL_ADDRESS = "temporal.env:7233";
    DashboardTemporalClient.connect();

    delete process.env.TEMPORAL_ADDRESS;
    DashboardTemporalClient.connect();

    expect(temporalClientMocks.lazy).toHaveBeenNthCalledWith(1, { address: "temporal.example:7233" });
    expect(temporalClientMocks.lazy).toHaveBeenNthCalledWith(2, { address: "temporal.env:7233" });
    expect(temporalClientMocks.lazy).toHaveBeenNthCalledWith(3, { address: "localhost:7233" });
    expect(temporalClientMocks.Client).toHaveBeenCalledTimes(3);
  });

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

  it("uses Temporal's typed workflow status name when describe returns one", async () => {
    const handle = {
      query: vi.fn().mockResolvedValue({
        taskId: "TASK-1",
        status: "running",
      }),
      describe: vi.fn().mockResolvedValue({ status: { code: 1, name: "RUNNING" } }),
      signal: vi.fn(),
    };
    const client = {
      workflow: {
        getHandle: vi.fn().mockReturnValue(handle),
      },
    };

    const temporal = new DashboardTemporalClient(client as any);
    const status = await temporal.getStatus("pi-agent-TASK-1");

    expect(status.temporalStatus).toBe("RUNNING");
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

  it("marks Temporal unavailable when status query does not return before the dashboard timeout", async () => {
    const handle = {
      query: vi.fn().mockReturnValue(new Promise(() => undefined)),
      describe: vi.fn().mockResolvedValue({ status: "RUNNING" }),
      signal: vi.fn(),
    };
    const client = {
      workflow: {
        getHandle: vi.fn().mockReturnValue(handle),
      },
    };

    const temporal = new DashboardTemporalClient(client as any, { statusTimeoutMs: 10 });
    const status = await Promise.race([
      temporal.getStatus("pi-agent-TASK-1"),
      new Promise((resolve) => setTimeout(() => resolve("still-pending"), 50)),
    ]);

    expect(status).toMatchObject({
      workflowId: "pi-agent-TASK-1",
      taskId: "TASK-1",
      status: "unavailable",
      temporalAvailable: false,
      comment: "Temporal status query timed out after 10ms",
    });
  });

  it("uses Temporal closed execution status when workflow query returns stale running state", async () => {
    const handle = {
      query: vi.fn().mockResolvedValue({
        taskId: "TASK-1",
        status: "running",
        stage: "normalize_requirements",
      }),
      describe: vi.fn().mockResolvedValue({ status: { code: 4, name: "CANCELED" } }),
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
      status: "canceled",
      stage: "normalize_requirements",
      temporalStatus: "CANCELED",
      temporalAvailable: true,
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
