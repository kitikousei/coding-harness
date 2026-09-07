export type SandboxLevel = "read-only" | "workspace-write" | "full-access";

export type SensitiveOperation =
  | "delete_file"
  | "install_dep"
  | "modify_ci"
  | "push_remote"
  | "create_pr";

export interface StageCapabilityManifest {
  stage: string;
  tools: {
    native: string[];
    mcp: string[];
    skills: string[];
  };
  mcpServers?: Array<{
    id: string;
    required: boolean;
  }>;
  sandbox: SandboxLevel;
  sensitiveOperations?: SensitiveOperation[];
  promptIncludes?: string[];
  promptTemplate: string;
  outputs: Array<{
    path: string;
    schema?: string;
    required: boolean;
  }>;
  constraints: {
    maxAgentRuns: number;
    maxToolCallsPerRun: number;
    allowSubagents: boolean;
    requireOutputFile: boolean;
    validateOutputSchema: boolean;
  };
}

export const STAGE_NAMES = [
  "normalize_requirements",
  "analyze_requirements",
  "codegraph_impact",
  "write_implementation_plan",
  "write_tests",
  "implement_code",
  "fix_test_failures",
  "review_diff",
  "publish_final_report",
] as const;
