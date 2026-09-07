import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { DefaultTestRunner } from "../../testing/TestRunner.js";
import { LocalArtifactStore } from "../../artifacts/LocalArtifactStore.js";

describe("TestRunner", () => {
  const testDir = resolve(process.cwd(), "test-runner-tmp");
  const taskId = "TASK-TEST-RUNNER";

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("runs test commands and produces result", async () => {
    const artifactStore = new LocalArtifactStore(testDir);
    await artifactStore.ensureTask(taskId);
    const runner = new DefaultTestRunner();

    // Run a command that will fail (echo is not a test command)
    const commands = [
      { command: "echo 'fake test'", cwd: testDir },
    ];

    const result = await runner.runTests(commands, taskId, testDir, artifactStore);
    // echo succeeds
    expect(result.passed).toBe(true);
    expect(result.commands).toContain("echo 'fake test'");
    expect(result.logFile).toBe(`artifacts/tasks/${taskId}/test-output.log`);

    // Verify test-result.json was written
    const testResult = await artifactStore.readJson(taskId, "test-result.json");
    expect(testResult.passed).toBe(true);
  });

  it("records failed tests when command exits non-zero", async () => {
    const artifactStore = new LocalArtifactStore(testDir);
    await artifactStore.ensureTask(taskId + "-fail");
    const runner = new DefaultTestRunner();

    const commands = [
      { command: "false", cwd: testDir },
    ];

    const result = await runner.runTests(commands, taskId + "-fail", testDir, artifactStore);
    expect(result.passed).toBe(false);
    expect(result.failedTests.length).toBeGreaterThan(0);
  });
});
