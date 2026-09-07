import { describe, it, expect } from "vitest";
import { stageTerminalStatus } from "../../workflows/LongEngineeringTaskWorkflow.js";

describe("LongEngineeringTaskWorkflow stage status handling", () => {
  it("continues when a stage succeeds", () => {
    const status = stageTerminalStatus("TASK-WF-001", "codegraph_impact", {
      status: "succeeded",
      summary: "done",
    });

    expect(status).toBeUndefined();
  });

  it("stops the workflow when codegraph impact is blocked", () => {
    const status = stageTerminalStatus("TASK-WF-001", "codegraph_impact", {
      status: "blocked",
      summary: "Required MCP server is not available",
    });

    expect(status).toEqual({
      taskId: "TASK-WF-001",
      status: "blocked",
      stage: "codegraph_impact",
      comment: "Required MCP server is not available",
    });
  });
});
