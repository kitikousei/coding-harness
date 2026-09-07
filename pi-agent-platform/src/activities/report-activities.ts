import { resolve } from "path";
import { mkdir, writeFile, readFile } from "fs/promises";
import { DefaultWorkspaceManager } from "../workspace/WorkspaceManager.js";
import { LocalArtifactStore } from "../artifacts/LocalArtifactStore.js";
import { FileBasedTestCommandResolver } from "../testing/TestCommandResolver.js";
import { FileBasedRegistry } from "../capability/CapabilityRegistry.js";

export async function collectDiffActivity(
  taskId: string,
  worktreePath: string,
  artifactRoot: string
): Promise<{ hasDiff: boolean; sizeBytes: number }> {
  const workspaceManager = new DefaultWorkspaceManager();
  const diff = await workspaceManager.collectDiff(worktreePath);

  if (!diff) {
    return { hasDiff: false, sizeBytes: 0 };
  }

  const diffPath = resolve(artifactRoot, "diff.patch");
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(diffPath, diff, "utf-8");

  return { hasDiff: true, sizeBytes: diff.length };
}

export async function publishFinalReportActivity(taskId: string): Promise<{ status: string; summary: string }> {
  const artifactStore = new LocalArtifactStore();
  const registry = new FileBasedRegistry();

  // Collect all stage events
  const events: any[] = [];
  try {
    const raw = await artifactStore.readText(taskId, "events.jsonl");
    for (const line of raw.trim().split("\n")) {
      if (line) events.push(JSON.parse(line));
    }
  } catch {
    // No events file
  }

  // Collect changed files from diff if present
  const changedFiles: string[] = [];
  try {
    const diffContent = await artifactStore.readText(taskId, "diff.patch");
    const diffLines = diffContent.split("\n");
    for (const line of diffLines) {
      const m = line.match(/^\+\+\+ b\/(.+)/);
      if (m) changedFiles.push(m[1]);
      const m2 = line.match(/^--- a\/(.+)/);
      if (m2 && !changedFiles.includes(m2[1])) changedFiles.push(m2[1]);
    }
  } catch {
    // No diff
  }

  // Collect test result
  let testPassed = true;
  let testCommands: string[] = [];
  try {
    const testResult = await artifactStore.readJson<Record<string, unknown>>(taskId, "test-result.json");
    testPassed = (testResult.passed as boolean) !== false;
    testCommands = (testResult.commands as string[]) || [];
  } catch {
    // No test result
  }

  // Collect requirements summary
  let requirementsSummary = "";
  try {
    const req = await artifactStore.readJson<Record<string, unknown>>(taskId, "requirements.json");
    requirementsSummary = ((req.functional_requirements as string[]) || []).join("; ");
  } catch {
    // No requirements
  }

  // Collect implementation plan summary
  let planSummary = "";
  try {
    const plan = await artifactStore.readJson<Record<string, unknown>>(taskId, "implementation-plan.json");
    planSummary = (plan.summary as string) || "";
  } catch {
    // No plan
  }

  // Determine overall status
  const stageEvents = events.filter((e) => e.event === "stage.completed");
  const failedEvents = events.filter((e) => e.event === "stage.failed" || e.event === "stage.blocked");
  const overallStatus = failedEvents.length > 0 ? "completed_with_issues" : "completed";

  const report = {
    task_id: taskId,
    status: overallStatus,
    summary: planSummary || "Task executed.",
    requirements_summary: requirementsSummary,
    changed_files: [...new Set(changedFiles)],
    test_commands: testCommands,
    test_passed: testPassed,
    stages_completed: stageEvents.length,
    stages_failed: failedEvents.length,
    risks: failedEvents.map((e) => e.summary),
  };

  await artifactStore.writeJson(taskId, "final-report.json", report);

  // Generate markdown report
  const mdLines = [
    `# Final Report: ${taskId}`,
    "",
    `## Status: ${overallStatus}`,
    "",
    `## Summary`,
    planSummary || "No plan summary available.",
    "",
    "## Requirements",
    requirementsSummary || "No requirements captured.",
    "",
    "## Changed Files",
    ...changedFiles.map((f) => `- ${f}`),
    "",
    "## Test Results",
    `Tests passed: ${testPassed}`,
    `Test commands: ${testCommands.join(", ") || "None"}`,
    "",
    "## Stages",
    `Completed: ${stageEvents.length}`,
    `Failed: ${failedEvents.length}`,
  ];

  if (failedEvents.length > 0) {
    mdLines.push("", "## Risks / Failures");
    for (const evt of failedEvents) {
      mdLines.push(`- [${evt.stage || "unknown"}] ${evt.summary}`);
    }
  }

  mdLines.push("");
  await artifactStore.writeText(taskId, "final-report.md", mdLines.join("\n"));

  return {
    status: overallStatus,
    summary: `Final report generated: ${stageEvents.length} stages completed, ${changedFiles.length} files changed.`,
  };
}
