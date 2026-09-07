import { createServer, type IncomingMessage, type RequestListener, type ServerResponse } from "http";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "path";
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
  taskStore: Pick<DashboardTaskStore, "listTasks" | "getTask" | "readEvents" | "readCostSummary">;
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
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unexpected server address");
  }

  return {
    url: `http://${options.host}:${address.port}`,
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

    const costMatch = path.match(/^\/api\/tasks\/([^/]+)\/cost$/);
    if (method === "GET" && costMatch) {
      const taskId = decodeURIComponent(costMatch[1]);
      const summary = await deps.taskStore.readCostSummary(taskId);
      return sendJson(res, 200, { cost: summary ?? null });
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
  const publicRoot = resolve(publicDir);
  const fullPath = resolve(publicRoot, "." + path);
  const relativePath = relative(publicRoot, fullPath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
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
