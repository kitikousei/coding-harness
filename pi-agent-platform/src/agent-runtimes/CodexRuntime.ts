import { execa } from "execa";
import { writeFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import type { AgentMCPServerConfig, AgentRuntime, AgentRunInput, AgentRunResult } from "./AgentRuntime.js";

export class CodexRuntime implements AgentRuntime {
  private codexBin: string;

  constructor(codexBin?: string) {
    this.codexBin = codexBin ?? "codex";
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const sandboxFlag = input.sandbox === "full-access" ? "danger-full-access" : input.sandbox;
    const args = [
      "exec",
      "--json",
      "--sandbox", sandboxFlag,
      "--cd", input.cwd,
    ];

    for (const mcpServer of input.mcpServers ?? []) {
      args.push(
        "-c",
        `mcp_servers.${toCodexMcpServerName(mcpServer.id)}.command=${JSON.stringify(mcpServer.command)}`,
        "-c",
        `mcp_servers.${toCodexMcpServerName(mcpServer.id)}.args=${JSON.stringify(mcpServer.args)}`
      );
    }

    if (input.outputSchema) {
      args.push("--output-schema", input.outputSchema);
    }

    args.push("--", input.prompt);

    const artifactRoot = resolve(input.cwd, `artifacts/tasks/${input.taskId}`);
    const stderrLog = resolve(artifactRoot, `${input.stage}.stderr.log`);

    try {
      const env = mergeMcpServerEnv(input.mcpServers ?? []);
      const result = await execa(this.codexBin, args, {
        cwd: input.cwd,
        reject: false,
        env,
      });

      // Save stderr
      await mkdir(dirname(stderrLog), { recursive: true });
      await writeFile(stderrLog, result.stderr, "utf-8");

      if (result.exitCode !== 0) {
        return {
          status: "failed",
          summary: `Codex exited with code ${result.exitCode}`,
          error: {
            type: "agent_exit_error",
            message: result.stderr || result.stdout,
            retryable: true,
          },
        };
      }

      // Try to parse JSON output
      try {
        const parsed = JSON.parse(result.stdout);
        if (parsed.status === "needs_input") {
          return {
            status: "needs_input",
            summary: parsed.summary || "Agent needs human input",
            outputArtifacts: parsed.outputFiles,
          };
        }
        return {
          status: "succeeded",
          summary: parsed.summary || "Codex completed",
          outputArtifacts: parsed.outputFiles,
          usage: parsed.usage,
        };
      } catch {
        return {
          status: "failed",
          summary: "Cannot parse Codex JSON output",
          error: {
            type: "invalid_agent_output",
            message: result.stdout.slice(0, 500),
            retryable: false,
          },
        };
      }
    } catch (err: any) {
      return {
        status: "failed",
        summary: `Codex execution failed: ${err.message}`,
        error: {
          type: "agent_execution_error",
          message: err.message,
          retryable: err.code === "ENOENT" ? false : true,
        },
      };
    }
  }
}

function toCodexMcpServerName(id: string): string {
  const withoutSuffix = id.endsWith("-mcp") ? id.slice(0, -"-mcp".length) : id;
  return withoutSuffix.replaceAll(/[^A-Za-z0-9_-]/g, "_");
}

function mergeMcpServerEnv(mcpServers: AgentMCPServerConfig[]): Record<string, string> | undefined {
  const env = Object.assign({}, ...mcpServers.map((server) => server.env ?? {}));
  return Object.keys(env).length > 0 ? env : undefined;
}
