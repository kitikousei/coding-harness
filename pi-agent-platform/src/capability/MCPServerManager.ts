import type { StageCapabilityManifest } from "./StageCapabilityManifest.js";
import type { AgentMCPServerConfig } from "../agent-runtimes/AgentRuntime.js";
import { access } from "fs/promises";
import { resolve } from "path";
import { StageBlockedError } from "./errors.js";

export interface MCPServerInfo {
  id: string;
  required: boolean;
}

export interface MCPServerStartOptions {
  worktreePath: string;
  repoPath?: string;
}

export interface MCPServerManager {
  startServers(
    manifest: StageCapabilityManifest,
    options?: MCPServerStartOptions
  ): Promise<{ started: AgentMCPServerConfig[]; warnings: string[] }>;
  stopServers(manifest: StageCapabilityManifest): Promise<void>;
}

export class DummyMCPServerManager implements MCPServerManager {
  private started = new Map<string, boolean>();

  async startServers(
    manifest: StageCapabilityManifest,
    options: MCPServerStartOptions = { worktreePath: process.cwd() }
  ): Promise<{ started: AgentMCPServerConfig[]; warnings: string[] }> {
    const started: AgentMCPServerConfig[] = [];
    const warnings: string[] = [];

    for (const server of manifest.mcpServers ?? []) {
      try {
        const config = await this.resolveServerConfig(server.id, options.worktreePath, options.repoPath);
        this.started.set(server.id, true);
        started.push(config);
      } catch (err) {
        if (err instanceof StageBlockedError) throw err;
        if (server.required) {
          throw new StageBlockedError(manifest.stage, `Required MCP server '${server.id}' failed: ${err}`);
        }
        warnings.push(`Optional MCP server '${server.id}' failed: ${err}`);
      }
    }

    return { started, warnings };
  }

  async stopServers(manifest: StageCapabilityManifest): Promise<void> {
    for (const server of manifest.mcpServers ?? []) {
      this.started.delete(server.id);
    }
  }

  private async resolveServerConfig(serverId: string, worktreePath: string, repoPath?: string): Promise<AgentMCPServerConfig> {
    if (serverId === "codegraph-mcp" || serverId === "codegraph") {
      // Use repoPath for codegraph index lookup (worktree is a fresh checkout without .codegraph)
      const indexPath = repoPath || worktreePath;
      await this.assertCodeGraphIndexAvailable(indexPath);
      return {
        id: serverId,
        command: "codegraph",
        args: ["serve", "--mcp", "--path", indexPath],
      };
    }

    throw new Error(`No runtime configuration is registered for MCP server '${serverId}'`);
  }

  private async assertCodeGraphIndexAvailable(worktreePath: string): Promise<void> {
    const dbPath = resolve(worktreePath, ".codegraph", "codegraph.db");
    try {
      await access(dbPath);
    } catch {
      throw new Error(`CodeGraph index not found at ${dbPath}. Run 'codegraph init -i ${worktreePath}' first.`);
    }
  }
}
