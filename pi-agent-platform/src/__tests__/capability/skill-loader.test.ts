import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { FileSkillLoader } from "../../capability/SkillLoader.js";
import { FileBasedRegistry } from "../../capability/CapabilityRegistry.js";

describe("SkillLoader", () => {
  const testDir = resolve(process.cwd(), "test-skills-tmp");

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    await mkdir(resolve(testDir, "code-graphing"), { recursive: true });
    await writeFile(resolve(testDir, "code-graphing", "SKILL.md"), "---\nname: code-graphing\ndescription: Graph codebases\n---\n\n# Code Graphing\n\nSkill content here.");
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads an existing skill", async () => {
    const loader = new FileSkillLoader(testDir);
    const results = await loader.loadSkills(["code-graphing"]);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("code-graphing");
    expect(results[0].content).toContain("Code Graphing");
    expect(results[0].warnings).toEqual([]);
  });

  it("records warning for missing skill", async () => {
    const loader = new FileSkillLoader(testDir);
    const results = await loader.loadSkills(["nonexistent-skill"]);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("");
    expect(results[0].warnings.length).toBeGreaterThan(0);
  });

  it("handles mix of existing and missing skills", async () => {
    const loader = new FileSkillLoader(testDir);
    const results = await loader.loadSkills(["code-graphing", "missing-skill"]);
    expect(results).toHaveLength(2);
    expect(results[0].warnings).toEqual([]);
    expect(results[1].warnings.length).toBeGreaterThan(0);
  });

  it("loads every skill declared by built-in manifests without warnings", async () => {
    const registry = new FileBasedRegistry();
    const stages = [
      "normalize_requirements",
      "analyze_requirements",
      "codegraph_impact",
      "write_implementation_plan",
      "write_tests",
      "implement_code",
      "fix_test_failures",
      "review_diff",
      "publish_final_report",
    ];
    const skillNames = new Set<string>();

    for (const stage of stages) {
      const manifest = await registry.loadManifest(stage);
      for (const skill of manifest.tools.skills) {
        skillNames.add(skill);
      }
    }

    const loader = new FileSkillLoader();
    const results = await loader.loadSkills([...skillNames]);

    expect(results.every((result) => result.content.length > 0)).toBe(true);
    expect(results.flatMap((result) => result.warnings)).toEqual([]);
  });
});
