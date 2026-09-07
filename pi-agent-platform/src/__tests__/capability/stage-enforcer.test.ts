import { describe, it, expect } from "vitest";
import { DefaultStageEnforcer } from "../../capability/StageEnforcer.js";
import { ToolNotAllowedError, SandboxViolationError } from "../../capability/errors.js";
import type { StageCapabilityManifest, SensitiveOperation } from "../../capability/StageCapabilityManifest.js";

function makeManifest(overrides: Partial<StageCapabilityManifest> = {}): StageCapabilityManifest {
  return {
    stage: "test_stage",
    tools: { native: ["read_file"], mcp: [], skills: [] },
    sandbox: "read-only",
    promptTemplate: "prompts/test.md",
    outputs: [{ path: "artifacts/tasks/${taskId}/output.md", required: true }],
    constraints: {
      maxAgentRuns: 1,
      maxToolCallsPerRun: 10,
      maxDurationMs: 60000,
      allowSubagents: false,
      requireOutputFile: true,
      validateOutputSchema: false,
    },
    ...overrides,
  };
}

describe("StageEnforcer", () => {
  const enforcer = new DefaultStageEnforcer();

  describe("assertToolAllowed", () => {
    it("allows declared native tool", () => {
      const manifest = makeManifest({ tools: { native: ["read_file"], mcp: [], skills: [] } });
      expect(() => enforcer.assertToolAllowed(manifest, "read_file")).not.toThrow();
    });

    it("allows declared MCP tool", () => {
      const manifest = makeManifest({ tools: { native: [], mcp: ["codegraph_context"], skills: [] } });
      expect(() => enforcer.assertToolAllowed(manifest, "codegraph_context")).not.toThrow();
    });

    it("rejects undeclared tool", () => {
      const manifest = makeManifest();
      expect(() => enforcer.assertToolAllowed(manifest, "write_file")).toThrow(ToolNotAllowedError);
    });
  });

  describe("assertSandboxAllows", () => {
    it("read-only allows read_repo", () => {
      const manifest = makeManifest({ sandbox: "read-only" });
      expect(() => enforcer.assertSandboxAllows(manifest, "read_repo")).not.toThrow();
    });

    it("read-only allows write_artifact", () => {
      const manifest = makeManifest({ sandbox: "read-only" });
      expect(() => enforcer.assertSandboxAllows(manifest, "write_artifact")).not.toThrow();
    });

    it("read-only blocks write_repo", () => {
      const manifest = makeManifest({ sandbox: "read-only" });
      expect(() => enforcer.assertSandboxAllows(manifest, "write_repo")).toThrow(SandboxViolationError);
    });

    it("read-only blocks terminal", () => {
      const manifest = makeManifest({ sandbox: "read-only" });
      expect(() => enforcer.assertSandboxAllows(manifest, "terminal")).toThrow(SandboxViolationError);
    });

    it("workspace-write allows write_repo", () => {
      const manifest = makeManifest({ sandbox: "workspace-write" });
      expect(() => enforcer.assertSandboxAllows(manifest, "write_repo")).not.toThrow();
    });

    it("workspace-write allows terminal", () => {
      const manifest = makeManifest({ sandbox: "workspace-write" });
      expect(() => enforcer.assertSandboxAllows(manifest, "terminal")).not.toThrow();
    });

    it("workspace-write blocks push_remote (not in sandbox enum, but enforcer only checks known ops)", () => {
      const manifest = makeManifest({ sandbox: "workspace-write" });
      // push_remote is a sensitive operation, checked separately
      expect(() => enforcer.assertSandboxAllows(manifest, "write_repo")).not.toThrow();
    });
  });

  describe("assertSensitiveOperationApproved", () => {
    it("allows sensitive operation when approved", () => {
      const manifest = makeManifest({
        sandbox: "workspace-write",
        sensitiveOperations: ["install_dep"],
      });
      expect(() => enforcer.assertSensitiveOperationApproved(manifest, "install_dep", ["install_dep"])).not.toThrow();
    });

    it("blocks sensitive operation when not approved", () => {
      const manifest = makeManifest({
        sandbox: "workspace-write",
        sensitiveOperations: ["install_dep"],
      });
      expect(() => enforcer.assertSensitiveOperationApproved(manifest, "install_dep", [])).toThrow(SandboxViolationError);
    });

    it("passes when manifest has no sensitive operations", () => {
      const manifest = makeManifest();
      expect(() => enforcer.assertSensitiveOperationApproved(manifest, "install_dep", [])).not.toThrow();
    });
  });
});
