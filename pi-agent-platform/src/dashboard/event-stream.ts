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
