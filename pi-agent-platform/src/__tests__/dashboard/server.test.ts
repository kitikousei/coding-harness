import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request, type Server } from "http";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { DashboardTemporalClient } from "../../dashboard/temporal-client.js";
import { createDashboardRequestHandler, startDashboardServer } from "../../dashboard/server.js";

describe("dashboard HTTP server", () => {
  let server: Server | undefined;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function start(deps: any): Promise<string> {
    server = createServer(createDashboardRequestHandler(deps));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected server address");
    return `http://127.0.0.1:${address.port}`;
  }

  async function requestRaw(baseUrl: string, path: string): Promise<{ status: number; body: string }> {
    const url = new URL(baseUrl);

    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: url.hostname,
          port: url.port,
          path,
          method: "GET",
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf-8"),
            });
          });
        }
      );

      req.on("error", reject);
      req.end();
    });
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

  it("returns cost summary for a task", async () => {
    const costSummary = {
      taskId: "TASK-1",
      stages: [{ stage: "implement_code", inputTokens: 10000, outputTokens: 5000, totalTokens: 15000, startedAt: "2026-09-04T10:00:00.000Z", completedAt: "2026-09-04T10:01:00.000Z" }],
      totals: { inputTokens: 10000, outputTokens: 5000, totalTokens: 15000 },
      updatedAt: "2026-09-04T10:01:00.000Z",
    };
    const baseUrl = await start({
      taskStore: { readCostSummary: vi.fn().mockResolvedValue(costSummary) },
      temporal: {},
    });

    const response = await fetch(`${baseUrl}/api/tasks/TASK-1/cost`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cost: costSummary });
  });

  it("returns null cost for task with no cost data", async () => {
    const baseUrl = await start({
      taskStore: { readCostSummary: vi.fn().mockResolvedValue(undefined) },
      temporal: {},
    });

    const response = await fetch(`${baseUrl}/api/tasks/TASK-1/cost`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cost: null });
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

  it("does not serve sibling files outside the public directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "dashboard-server-"));
    tempDirs.push(root);
    const publicDir = join(root, "public");
    const siblingDir = join(root, "public-leak");
    await mkdir(publicDir, { recursive: true });
    await mkdir(siblingDir, { recursive: true });
    await writeFile(join(publicDir, "index.html"), "ok");
    await writeFile(join(siblingDir, "secret.txt"), "top-secret");

    const baseUrl = await start({ taskStore: {}, temporal: {}, publicDir });
    const response = await requestRaw(baseUrl, "/../public-leak/secret.txt");

    expect([403, 404]).toContain(response.status);
    expect(response.body).not.toContain("top-secret");
  });

  it("returns the actual bound port when starting on an ephemeral port", async () => {
    const root = await mkdtemp(join(tmpdir(), "dashboard-server-"));
    tempDirs.push(root);
    vi.spyOn(DashboardTemporalClient, "connect").mockReturnValue({} as any);

    const started = await startDashboardServer({
      host: "127.0.0.1",
      port: 0,
      artifactRoot: root,
      temporalAddress: "temporal.example:7233",
    });

    try {
      expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(started.url).not.toBe("http://127.0.0.1:0");
    } finally {
      await started.close();
    }
  });
});
