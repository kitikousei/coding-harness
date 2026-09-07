import type { StageCapabilityManifest, SandboxLevel, SensitiveOperation } from "./StageCapabilityManifest.js";
import { ToolNotAllowedError, SandboxViolationError } from "./errors.js";

export interface StageEnforcer {
  assertToolAllowed(manifest: StageCapabilityManifest, toolName: string): void;
  assertSandboxAllows(
    manifest: StageCapabilityManifest,
    operation: "read_repo" | "write_repo" | "write_artifact" | "terminal"
  ): void;
  assertSensitiveOperationApproved(
    manifest: StageCapabilityManifest,
    operation: SensitiveOperation,
    approvedOperations: SensitiveOperation[]
  ): void;
}

export class DefaultStageEnforcer implements StageEnforcer {
  assertToolAllowed(manifest: StageCapabilityManifest, toolName: string): void {
    const allowed = [...manifest.tools.native, ...manifest.tools.mcp];
    if (!allowed.includes(toolName)) {
      throw new ToolNotAllowedError(toolName, manifest.stage);
    }
  }

  assertSandboxAllows(
    manifest: StageCapabilityManifest,
    operation: "read_repo" | "write_repo" | "write_artifact" | "terminal"
  ): void {
    const { sandbox } = manifest;

    // All sandboxes allow read_repo
    if (operation === "read_repo") return;

    if (sandbox === "read-only") {
      if (operation === "write_artifact") return;
      throw new SandboxViolationError(operation, manifest.stage);
    }

    if (sandbox === "workspace-write") {
      if (operation === "write_repo" || operation === "write_artifact" || operation === "terminal") {
        return;
      }
      throw new SandboxViolationError(operation, manifest.stage);
    }

    // full-access allows everything
    if (sandbox === "full-access") return;

    throw new SandboxViolationError(operation, manifest.stage);
  }

  assertSensitiveOperationApproved(
    manifest: StageCapabilityManifest,
    operation: SensitiveOperation,
    approvedOperations: SensitiveOperation[]
  ): void {
    const sensitive = manifest.sensitiveOperations ?? [];
    if (sensitive.includes(operation) && !approvedOperations.includes(operation)) {
      throw new SandboxViolationError(
        `sensitive operation '${operation}' not approved`,
        manifest.stage
      );
    }
  }
}
