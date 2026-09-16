import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, readFile } from "fs/promises";
import { resolve } from "path";
import { LocalArtifactStore } from "../../artifacts/LocalArtifactStore.js";

describe("LocalArtifactStore", () => {
  const testDir = resolve(process.cwd(), "test-artifact-store-tmp");

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("ensureTask creates directory", async () => {
    const store = new LocalArtifactStore(testDir);
    await store.ensureTask("TASK-TEST-1");
    const { access } = await import("fs/promises");
    await access(resolve(testDir, "artifacts/tasks/TASK-TEST-1"));
    // If no error thrown, dir exists
    expect(true).toBe(true);
  });

  it("writeText and readText are consistent", async () => {
    const store = new LocalArtifactStore(testDir);
    await store.ensureTask("TASK-TEST-2");
    await store.writeText("TASK-TEST-2", "hello.md", "Hello world content");
    const read = await store.readText("TASK-TEST-2", "hello.md");
    expect(read).toBe("Hello world content");
  });

  it("writeJson writes formatted JSON", async () => {
    const store = new LocalArtifactStore(testDir);
    await store.ensureTask("TASK-TEST-3");
    await store.writeJson("TASK-TEST-3", "data.json", { foo: "bar", num: 42 });
    const raw = await store.readText("TASK-TEST-3", "data.json");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ foo: "bar", num: 42 });
    expect(raw).toContain("\n"); // formatted
  });

  it("appendEvent appends without overwriting", async () => {
    const store = new LocalArtifactStore(testDir);
    await store.ensureTask("TASK-TEST-4");
    await store.appendEvent("TASK-TEST-4", {
      taskId: "TASK-TEST-4",
      stage: "normalize_requirements",
      event: "stage.completed",
      createdAt: "2026-09-03T08:00:00.000Z",
      summary: "First event",
    });
    await store.appendEvent("TASK-TEST-4", {
      taskId: "TASK-TEST-4",
      stage: "analyze_requirements",
      event: "stage.completed",
      createdAt: "2026-09-03T08:01:00.000Z",
      summary: "Second event",
    });
    const raw = await store.readText("TASK-TEST-4", "events.jsonl");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).summary).toBe("First event");
    expect(JSON.parse(lines[1]).summary).toBe("Second event");
  });

  it("exists returns true for existing and false for missing", async () => {
    const store = new LocalArtifactStore(testDir);
    await store.ensureTask("TASK-TEST-5");
    await store.writeText("TASK-TEST-5", "exists.md", "content here");
    expect(await store.exists("TASK-TEST-5", "exists.md")).toBe(true);
    expect(await store.exists("TASK-TEST-5", "missing.md")).toBe(false);
  });
});
