import type { AgentRuntime } from "./AgentRuntime.js";
import { CodexRuntime } from "./CodexRuntime.js";
import { MockRuntime } from "./MockRuntime.js";
import { PiCliRuntime } from "./PiCliRuntime.js";
import { PiAgentRuntime } from "./PiAgentRuntime.js";

export type AgentRuntimeName = "mock" | "pi" | "pi-cli" | "codex";

export function createAgentRuntime(runtime: string): AgentRuntime {
  switch (runtime) {
    case "mock":
      return new MockRuntime();
    case "pi":
      return new PiAgentRuntime();
    case "pi-cli":
      return new PiCliRuntime();
    case "codex":
      return new CodexRuntime();
    default:
      throw new Error(`Unknown agent runtime '${runtime}'. Expected one of: mock, pi, pi-cli, codex.`);
  }
}
