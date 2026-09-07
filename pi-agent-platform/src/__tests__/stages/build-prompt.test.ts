import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { buildPrompt } from "../../stages/buildPrompt.js";
import type { StageCapabilityManifest } from "../../capability/StageCapabilityManifest.js";

describe("buildPrompt", () => {
  const fixtureDir = "test-buildprompt-tmp";

  beforeAll(async () => {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(`${fixtureDir}/GLOBAL_RULES.md`, "GLOBAL SAFETY RULE for ${taskId}.\n", "utf-8");
    await writeFile(`${fixtureDir}/stage.md`, "STAGE BODY for ${taskId} at ${artifactRoot}.\n", "utf-8");
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("substitutes variables in template", async () => {
    // We need a real prompt file to read
    const manifest: StageCapabilityManifest = {
      stage: "normalize_requirements",
      tools: { native: ["read_file"], mcp: [], skills: [] },
      sandbox: "read-only",
      promptTemplate: "prompts/normalize-requirements.md",
      outputs: [{ path: "out.md", required: true }],
      constraints: {
        maxAgentRuns: 1,
        maxToolCallsPerRun: 10,
        maxDurationMs: 60000,
        allowSubagents: false,
        requireOutputFile: true,
        validateOutputSchema: false,
      },
    };

    const prompt = await buildPrompt(manifest, {
      taskId: "TASK-1",
      artifactRoot: "artifacts/tasks/TASK-1",
      worktreePath: "/tmp/repo",
    });

    expect(prompt).toContain("TASK-1");
    expect(prompt).toContain("artifacts/tasks/TASK-1");
    expect(prompt).not.toContain("${taskId}");
    expect(prompt).not.toContain("${artifactRoot}");
  });

  it("assembles includes, stage instructions, skills, and runtime context in order", async () => {
    const manifest: StageCapabilityManifest & { promptIncludes: string[] } = {
      stage: "fixture_stage",
      tools: { native: ["read_file"], mcp: [], skills: [] },
      sandbox: "read-only",
      promptIncludes: [`${fixtureDir}/GLOBAL_RULES.md`],
      promptTemplate: `${fixtureDir}/stage.md`,
      outputs: [{ path: "out.md", required: true }],
      constraints: {
        maxAgentRuns: 1,
        maxToolCallsPerRun: 10,
        maxDurationMs: 60000,
        allowSubagents: false,
        requireOutputFile: true,
        validateOutputSchema: false,
      },
    };

    const prompt = await buildPrompt(
      manifest,
      {
        taskId: "TASK-CTX",
        artifactRoot: "artifacts/tasks/TASK-CTX",
        worktreePath: "/tmp/repo",
      },
      [{ name: "tdd", content: "Use tests before production changes.", warnings: [] }],
      { humanCorrection: "Keep the public API unchanged.", attempt: 2 }
    );

    const globalIndex = prompt.indexOf("GLOBAL SAFETY RULE for TASK-CTX.");
    const stageIndex = prompt.indexOf("STAGE BODY for TASK-CTX at artifacts/tasks/TASK-CTX.");
    const skillIndex = prompt.indexOf("Use tests before production changes.");
    const contextIndex = prompt.indexOf("\"humanCorrection\": \"Keep the public API unchanged.\"");

    expect(globalIndex).toBeGreaterThanOrEqual(0);
    expect(stageIndex).toBeGreaterThan(globalIndex);
    expect(skillIndex).toBeGreaterThan(stageIndex);
    expect(contextIndex).toBeGreaterThan(skillIndex);
  });
});
