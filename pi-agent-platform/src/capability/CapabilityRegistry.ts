import type { StageCapabilityManifest } from "./StageCapabilityManifest.js";
import { ManifestNotFoundError, ManifestValidationError } from "./errors.js";

// Import all manifest JSON files directly. Vitest and Node.js (with resolveJsonModule) both support this.
import normalizeRequirements from "./manifests/normalize-requirements.json" with { type: "json" };
import analyzeRequirements from "./manifests/analyze-requirements.json" with { type: "json" };
import codegraphImpact from "./manifests/codegraph-impact.json" with { type: "json" };
import writeImplementationPlan from "./manifests/write-implementation-plan.json" with { type: "json" };
import writeTests from "./manifests/write-tests.json" with { type: "json" };
import implementCode from "./manifests/implement-code.json" with { type: "json" };
import fixTestFailures from "./manifests/fix-test-failures.json" with { type: "json" };
import reviewDiff from "./manifests/review-diff.json" with { type: "json" };
import publishFinalReport from "./manifests/publish-final-report.json" with { type: "json" };

const MANIFEST_MAP: Record<string, StageCapabilityManifest> = {
  normalize_requirements: normalizeRequirements as StageCapabilityManifest,
  analyze_requirements: analyzeRequirements as StageCapabilityManifest,
  codegraph_impact: codegraphImpact as StageCapabilityManifest,
  write_implementation_plan: writeImplementationPlan as StageCapabilityManifest,
  write_tests: writeTests as StageCapabilityManifest,
  implement_code: implementCode as StageCapabilityManifest,
  fix_test_failures: fixTestFailures as StageCapabilityManifest,
  review_diff: reviewDiff as StageCapabilityManifest,
  publish_final_report: publishFinalReport as StageCapabilityManifest,
};

export interface CapabilityRegistry {
  loadManifest(stage: string): Promise<StageCapabilityManifest>;
  resolveAllowedTools(manifest: StageCapabilityManifest): string[];
  hasTool(toolName: string): boolean;
  hasMCPServer(serverId: string): boolean;
  hasSkill(skillName: string): boolean;
}

export class FileBasedRegistry implements CapabilityRegistry {
  private cache = new Map<string, StageCapabilityManifest>();
  private knownTools = new Set<string>();
  private knownMCPServers = new Set<string>();
  private knownSkills = new Set<string>();

  async loadManifest(stage: string): Promise<StageCapabilityManifest> {
    if (this.cache.has(stage)) {
      return this.cache.get(stage)!;
    }

    const manifest = MANIFEST_MAP[stage];
    if (!manifest) {
      throw new ManifestNotFoundError(stage);
    }

    // Deep clone to avoid mutation across tests
    const cloned = JSON.parse(JSON.stringify(manifest)) as StageCapabilityManifest;
    this.validateManifestStructure(cloned, stage);

    // Index known resources
    for (const tool of cloned.tools.native) this.knownTools.add(tool);
    for (const tool of cloned.tools.mcp) this.knownTools.add(tool);
    for (const srv of cloned.mcpServers ?? []) this.knownMCPServers.add(srv.id);
    for (const skill of cloned.tools.skills) this.knownSkills.add(skill);

    this.cache.set(stage, cloned);
    return cloned;
  }

  resolveAllowedTools(manifest: StageCapabilityManifest): string[] {
    return [...manifest.tools.native, ...manifest.tools.mcp];
  }

  hasTool(toolName: string): boolean {
    return this.knownTools.has(toolName);
  }

  hasMCPServer(serverId: string): boolean {
    return this.knownMCPServers.has(serverId);
  }

  hasSkill(skillName: string): boolean {
    return this.knownSkills.has(skillName);
  }

  private validateManifestStructure(manifest: StageCapabilityManifest, stage: string) {
    if (manifest.stage !== stage) {
      throw new ManifestValidationError(
        stage,
        `Stage name mismatch: file expects '${stage}' but manifest declares '${manifest.stage}'`
      );
    }

    for (const field of ["tools", "sandbox", "outputs", "constraints", "promptTemplate"] as const) {
      if (!(field in manifest)) {
        throw new ManifestValidationError(stage, `Missing required field: ${field}`);
      }
    }

    if (manifest.sandbox === "read-only" && manifest.tools.native.includes("write_file")) {
      throw new ManifestValidationError(
        stage,
        "read-only sandbox cannot declare 'write_file' tool (use 'write_artifact' instead)"
      );
    }

    if (
      manifest.promptIncludes !== undefined &&
      (!Array.isArray(manifest.promptIncludes) || manifest.promptIncludes.some((path) => typeof path !== "string"))
    ) {
      throw new ManifestValidationError(stage, "promptIncludes must be an array of strings");
    }

    if (manifest.tools.mcp.length > 0 && (!manifest.mcpServers || manifest.mcpServers.length === 0)) {
      throw new ManifestValidationError(stage, "stages with MCP tools must declare at least one mcpServer");
    }

    if (!Array.isArray(manifest.outputs) || manifest.outputs.length === 0) {
      throw new ManifestValidationError(stage, "outputs must be a non-empty array");
    }

    for (const out of manifest.outputs) {
      if (!out.path) {
        throw new ManifestValidationError(stage, "Each output must have a 'path' field");
      }
      if (typeof out.required !== "boolean") {
        throw new ManifestValidationError(stage, "Each output must have a 'required' boolean field");
      }
    }

    const c = manifest.constraints;
    for (const field of ["maxAgentRuns", "maxToolCallsPerRun", "allowSubagents", "requireOutputFile", "validateOutputSchema"] as const) {
      if (!(field in c)) {
        throw new ManifestValidationError(stage, `Missing constraint: ${field}`);
      }
    }
  }
}
