import { describe, expect, it } from "vitest";
import { formatWorkflowExecutionStatus } from "../../cli/commands/workflow.js";

describe("formatWorkflowExecutionStatus", () => {
  it("uses Temporal's status name when present", () => {
    expect(formatWorkflowExecutionStatus({ code: 1, name: "RUNNING" })).toBe("RUNNING");
  });

  it("falls back to JSON for unknown status shapes", () => {
    expect(formatWorkflowExecutionStatus(1)).toBe("1");
  });
});
