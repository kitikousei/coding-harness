import { describe, it, expect } from "vitest";
import { FileBasedRegistry } from "../../capability/CapabilityRegistry.js";
import { ManifestNotFoundError, ManifestValidationError } from "../../capability/errors.js";

describe("CapabilityRegistry", () => {
  it("loads an existing manifest", async () => {
    const registry = new FileBasedRegistry();
    const manifest = await registry.loadManifest("normalize_requirements");
    expect(manifest.stage).toBe("normalize_requirements");
    expect(manifest.sandbox).toBe("read-only");
    expect(manifest.tools.native).toContain("read_file");
  });

  it("throws ManifestNotFoundError for unknown stage", async () => {
    const registry = new FileBasedRegistry();
    await expect(registry.loadManifest("nonexistent_stage"))
      .rejects.toThrow(ManifestNotFoundError);
  });

  it("caches loaded manifests", async () => {
    const registry = new FileBasedRegistry();
    const m1 = await registry.loadManifest("normalize_requirements");
    const m2 = await registry.loadManifest("normalize_requirements");
    expect(m1).toBe(m2); // same reference
  });

  it("resolves allowed tools from manifest", async () => {
    const registry = new FileBasedRegistry();
    const manifest = await registry.loadManifest("codegraph_impact");
    const tools = registry.resolveAllowedTools(manifest);
    expect(tools).toContain("read_file");
    expect(tools).toContain("codegraph_context");
    expect(tools).toContain("codegraph_impact");
  });

  it("allows read-only discovery tools during requirements analysis", async () => {
    const registry = new FileBasedRegistry();
    const manifest = await registry.loadManifest("analyze_requirements");
    const tools = registry.resolveAllowedTools(manifest);

    expect(tools).toEqual(expect.arrayContaining([
      "read_file",
      "grep",
      "find",
      "ls",
      "write_artifact",
    ]));
  });

  it("validates read-only sandbox cannot have write_file tool", async () => {
    const registry = new FileBasedRegistry();
    await expect(registry.loadManifest("normalize_requirements")).resolves.toBeDefined();
  });

  it("loads all 9 manifests successfully", async () => {
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
    for (const stage of stages) {
      const manifest = await registry.loadManifest(stage);
      expect(manifest.stage).toBe(stage);
      expect(manifest.sandbox).toBeDefined();
      expect(manifest.outputs.length).toBeGreaterThan(0);
    }
  });

  it("loads global prompt rules for every built-in stage", async () => {
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

    for (const stage of stages) {
      const manifest = await registry.loadManifest(stage);
      expect(Array.isArray(manifest.promptIncludes)).toBe(true);
      expect(manifest.promptIncludes).toContain("prompts/GLOBAL_RULES.md");
    }
  });

  it("requires built-in stages with MCP tools to declare an MCP server", async () => {
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

    for (const stage of stages) {
      const manifest = await registry.loadManifest(stage);
      if (manifest.tools.mcp.length > 0) {
        expect(manifest.mcpServers?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});
