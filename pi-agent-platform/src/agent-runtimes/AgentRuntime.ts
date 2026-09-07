export interface AgentMCPServerConfig {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentRunInput {
  taskId: string;
  stage: string;
  cwd: string;
  prompt: string;
  promptFile?: string;
  sandbox: "read-only" | "workspace-write" | "full-access";
  tools: string[];
  mcpServers?: AgentMCPServerConfig[];
  outputSchema?: string;
  outputFile?: string;
  artifactRoot?: string;
  allowedOutputPaths?: string[];
  timeoutMs?: number;
  maxToolCallsPerRun?: number;
  context?: Record<string, unknown>;
  model?: string;
  provider?: string;
}

export interface AgentRunResult {
  status: "succeeded" | "failed" | "needs_input";
  summary: string;
  outputFile?: string;
  logFile?: string;
  outputArtifacts?: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  error?: {
    type: string;
    message: string;
    retryable: boolean;
  };
}

export interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
