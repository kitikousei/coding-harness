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
