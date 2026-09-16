import { describe, it, expect } from "vitest";
import { taskArtifactRoot, taskArtifactPath } from "../../artifacts/TaskArtifactPaths.js";

describe("TaskArtifactPaths", () => {
  it("returns correct root for a task id", () => {
    expect(taskArtifactRoot("TASK-1")).toBe("artifacts/tasks/TASK-1");
  });

  it("returns correct path for a filename", () => {
    expect(taskArtifactPath("TASK-1", "input.md")).toBe("artifacts/tasks/TASK-1/input.md");
  });

  it("throws for empty task id on root", () => {
    expect(() => taskArtifactRoot("")).toThrow("taskId cannot be empty");
  });

  it("throws for empty task id on path", () => {
    expect(() => taskArtifactPath("", "input.md")).toThrow("taskId cannot be empty");
  });
});
