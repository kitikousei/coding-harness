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

export function normalizeProgressLine(input: NormalizeStderrLineInput): DashboardEvent | undefined {
  const line = input.line.trim();
  if (!line) return undefined;

  // Format: [2026-09-05T10:19:44.840Z] [🔧 Tool call END] write ✅ OK → message...
  const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]\s*/);
  const createdAt = tsMatch ? tsMatch[1] : new Date().toISOString();
  const rest = tsMatch ? line.slice(tsMatch[0].length) : line;

  // Extract the bracketed event type
  const typeMatch = rest.match(/^\[([^\]]+)\]\s*/);
  const eventType = typeMatch ? typeMatch[1] : "";
  const summary = typeMatch ? rest.slice(typeMatch[0].length) : rest;

  // Determine level
  let level: DashboardEventLevel = "debug";
  if (line.includes("❌ ERROR") || line.includes("error") || line.includes("failed")) level = "error";
  else if (line.includes("⚠") || line.includes("warn")) level = "warn";
  else if (line.includes("✅ OK") || line.includes("completed") || line.includes("exited") || line.includes("started")) level = "info";

  return {
    id: eventId(input.file, input.lineNumber),
    taskId: input.taskId,
    source: "agent",
    stage: input.stage,
    level,
    event: eventType || "progress.line",
    createdAt,
    summary: summary || line,
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
  if (raw.type === "tool_execution_start" || raw.type === "tool_execution_end") return "info";
  // Lifecycle events — noisy, demote to debug
  if (raw.type === "turn_start" || raw.type === "turn_end") return "debug";
  if (raw.type === "message_start" || raw.type === "message_end") return "debug";
  if (raw.type === "agent_settled" || raw.type === "agent_start" || raw.type === "agent_end") return "debug";
  // message_update: elevate based on nested event type
  if (raw.type === "message_update") {
    const nested = (raw.assistantMessageEvent as Record<string, unknown>)?.type;
    if (nested === "toolcall_start" || nested === "toolcall_end" || nested === "tool_call_start" || nested === "tool_call_end") return "info";
    if (nested === "thinking_start" || nested === "thinking_end" || nested === "text_start" || nested === "text_end") return "debug";
    if (nested === "toolcall_delta" || nested === "thinking_delta" || nested === "text_delta") return "debug";
    return "debug";
  }
  return "debug";
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
    const nestedType = assistantEvent?.type as string | undefined;
    const delta = assistantEvent?.delta as string | undefined;

    if (nestedType === "text_delta" && delta) return delta.slice(0, 100);
    if (nestedType === "thinking_delta" && delta) return `Thinking: ${delta.slice(0, 100)}`;
    if (nestedType === "toolcall_delta" || nestedType === "tool_call_delta") {
      const partial = assistantEvent?.partial as Record<string, unknown> | undefined;
      const content = (partial?.content as any[])?.[0];
      if (content?.type === "tool_call") return `Tool call: ${content.name || "?"}(${JSON.stringify(content.arguments || {}).slice(0, 80)})`;
    }
    if (nestedType === "toolcall_start" || nestedType === "tool_call_start") {
      const tool = stringValue(assistantEvent?.toolName as string) || stringValue(assistantEvent?.tool as string) || "?";
      return `Tool started: ${tool}`;
    }
    if (nestedType === "toolcall_end" || nestedType === "tool_call_end") return `Tool completed`;
    if (nestedType === "thinking_start") return `Thinking started`;
    if (nestedType === "thinking_end") return `Thinking ended`;
    if (nestedType === "text_start") return `Text generation started`;
    if (nestedType === "text_end") return `Text generation ended`;
    if (nestedType) return nestedType;
  }

  return type;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function eventId(file: string, lineNumber: number): string {
  return `${file}:${lineNumber}`;
}
