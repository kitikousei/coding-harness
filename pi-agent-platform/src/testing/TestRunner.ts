import { writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { execa } from "execa";
import type { TestCommand } from "./TestCommandResolver.js";
import type { ArtifactStore } from "../artifacts/LocalArtifactStore.js";

export interface TestResult {
  passed: boolean;
  commands: string[];
  failedTests: Array<{ name: string; message: string }>;
  logFile: string;
}

export interface TestRunner {
  runTests(commands: TestCommand[], taskId: string, worktreePath: string, artifactStore: ArtifactStore): Promise<TestResult>;
}

export class DefaultTestRunner implements TestRunner {
  async runTests(
    commands: TestCommand[],
    taskId: string,
    worktreePath: string,
    artifactStore: ArtifactStore
  ): Promise<TestResult> {
    const commandsRun: string[] = [];
    const failedTests: Array<{ name: string; message: string }> = [];
    const allLogs: string[] = [];

    for (const cmd of commands) {
      commandsRun.push(cmd.command);

      try {
        const result = await execa(cmd.command.split(" ")[0], cmd.command.split(" ").slice(1), {
          cwd: cmd.cwd || worktreePath,
          reject: false,
          timeout: 120_000,
        });

        const log = `[${cmd.command}] exit: ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
        allLogs.push(log);

        if (result.exitCode !== 0) {
          failedTests.push({
            name: cmd.command,
            message: result.stderr || result.stdout || `Exit code ${result.exitCode}`,
          });
        }
      } catch (err: any) {
        const log = `[${cmd.command}] error: ${err.message}`;
        allLogs.push(log);
        failedTests.push({ name: cmd.command, message: err.message });
      }
    }

    const logContent = allLogs.join("\n\n---\n\n");
    const logFileName = "test-output.log";
    const logPath = resolve(worktreePath, `artifacts/tasks/${taskId}`, logFileName);
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath, logContent, "utf-8");

    const testResult: TestResult = {
      passed: failedTests.length === 0,
      commands: commandsRun,
      failedTests,
      logFile: `artifacts/tasks/${taskId}/${logFileName}`,
    };

    // Write structured test result
    await artifactStore.writeJson(taskId, "test-result.json", testResult);

    return testResult;
  }
}
