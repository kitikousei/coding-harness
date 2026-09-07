export class StageError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
    public readonly type: string
  ) {
    super(message);
    this.name = "StageError";
  }
}

export class ManifestNotFoundError extends StageError {
  constructor(stage: string) {
    super(`Manifest not found for stage: ${stage}`, stage, "manifest_not_found");
  }
}

export class ManifestValidationError extends StageError {
  constructor(stage: string, message: string) {
    super(`Manifest validation failed for stage ${stage}: ${message}`, stage, "manifest_validation_error");
  }
}

export class StageBlockedError extends StageError {
  constructor(stage: string, message: string) {
    super(`Stage blocked: ${message}`, stage, "stage_blocked");
  }
}

export class ToolNotAllowedError extends StageError {
  constructor(tool: string, stage: string) {
    super(`Tool '${tool}' is not allowed in stage '${stage}'`, stage, "tool_not_allowed");
  }
}

export class SandboxViolationError extends StageError {
  constructor(operation: string, stage: string) {
    super(`Sandbox violation: '${operation}' not allowed in stage '${stage}'`, stage, "sandbox_violation");
  }
}

export class OutputValidationError extends StageError {
  constructor(stage: string, message: string) {
    super(`Output validation failed for stage ${stage}: ${message}`, stage, "output_validation_error");
  }
}

export class MCPServerError extends StageError {
  constructor(serverId: string, message: string) {
    super(`MCP server '${serverId}' error: ${message}`, "", "mcp_server_error");
  }
}
