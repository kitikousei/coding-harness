import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { DefaultOutputValidator } from "../../capability/OutputValidator.js";
import type { StageCapabilityManifest } from "../../capability/StageCapabilityManifest.js";

describe("OutputValidator", () => {
  const testDir = resolve(process.cwd(), "test-validator-tmp");

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function makeManifest(outputs: StageCapabilityManifest["outputs"]): StageCapabilityManifest {
    return {
      stage: "test",
      tools: { native: [], mcp: [], skills: [] },
      sandbox: "read-only",
      promptTemplate: "prompts/test.md",
      outputs,
      constraints: {
        maxAgentRuns: 1,
        maxToolCallsPerRun: 10,
        maxDurationMs: 60000,
        allowSubagents: false,
        requireOutputFile: true,
        validateOutputSchema: true,
      },
    };
  }

  it("reports error when required file is missing", async () => {
    const validator = new DefaultOutputValidator();
    const manifest = makeManifest([
      { path: `${testDir}/missing.json`, required: true, schema: "schemas/requirements.schema.json" },
    ]);
    const result = await validator.validateOutputs("TASK-1", manifest, testDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("missing");
  });

  it("reports error when file is too small", async () => {
    await writeFile(resolve(testDir, "small.json"), "{}", "utf-8");
    const validator = new DefaultOutputValidator();
    const manifest = makeManifest([
      { path: `${testDir}/small.json`, required: true },
    ]);
    const result = await validator.validateOutputs("TASK-1", manifest, testDir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("too small");
  });

  it("passes when required file exists and is large enough", async () => {
    const content = JSON.stringify({
      background: "Test",
      goals: ["A"],
      non_goals: [],
      functional_requirements: ["B"],
      constraints: ["C"],
      acceptance_criteria: ["D"],
      open_questions: [],
    });
    const filePath = resolve(testDir, "valid-req.json");
    await writeFile(filePath, content, "utf-8");

    const validator = new DefaultOutputValidator();
    const manifest = makeManifest([
      { path: `${testDir}/valid-req.json`, required: true },
    ]);
    const result = await validator.validateOutputs("TASK-1", manifest, testDir);
    expect(result.valid).toBe(true);
  });

  it("validates JSON schema correctly", async () => {
    // Write a valid requirements.json
    const validContent = JSON.stringify({
      background: "Test",
      goals: ["A"],
      non_goals: [],
      functional_requirements: ["B"],
      constraints: ["C"],
      acceptance_criteria: ["D"],
      open_questions: [],
    });
    await writeFile(resolve(testDir, "schema-valid.json"), validContent, "utf-8");

    const validator = new DefaultOutputValidator();
    const manifest = makeManifest([
      { path: `${testDir}/schema-valid.json`, required: true, schema: "schemas/requirements.schema.json" },
    ]);
    const result = await validator.validateOutputs("TASK-1", manifest, testDir);
    expect(result.valid).toBe(true);

    // Write an invalid one (missing goals)
    const invalidContent = JSON.stringify({
      background: "Test",
      non_goals: [],
      functional_requirements: ["B"],
      constraints: ["C"],
      acceptance_criteria: ["D"],
      open_questions: [],
    });
    await writeFile(resolve(testDir, "schema-invalid.json"), invalidContent, "utf-8");

    const manifest2 = makeManifest([
      { path: `${testDir}/schema-invalid.json`, required: true, schema: "schemas/requirements.schema.json" },
    ]);
    const result2 = await validator.validateOutputs("TASK-1", manifest2, testDir);
    expect(result2.valid).toBe(false);
    expect(result2.errors[0]).toContain("Schema validation");
  });
});
