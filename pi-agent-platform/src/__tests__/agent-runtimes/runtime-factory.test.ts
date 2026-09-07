import { describe, it, expect } from "vitest";
import { CodexRuntime } from "../../agent-runtimes/CodexRuntime.js";
import { MockRuntime } from "../../agent-runtimes/MockRuntime.js";
import { PiCliRuntime } from "../../agent-runtimes/PiCliRuntime.js";
import { PiAgentRuntime } from "../../agent-runtimes/PiAgentRuntime.js";
import { createAgentRuntime } from "../../agent-runtimes/RuntimeFactory.js";

describe("createAgentRuntime", () => {
  it("creates the requested runtime implementation", () => {
    expect(createAgentRuntime("mock")).toBeInstanceOf(MockRuntime);
    expect(createAgentRuntime("pi")).toBeInstanceOf(PiAgentRuntime);
    expect(createAgentRuntime("pi-cli")).toBeInstanceOf(PiCliRuntime);
    expect(createAgentRuntime("codex")).toBeInstanceOf(CodexRuntime);
  });

  it("rejects unknown runtimes instead of silently falling back to mock", () => {
    expect(() => createAgentRuntime("unknown")).toThrow("Unknown agent runtime");
  });
});
