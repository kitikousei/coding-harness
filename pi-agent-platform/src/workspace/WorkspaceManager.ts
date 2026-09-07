import { mkdir } from "fs/promises";
import { resolve } from "path";
import { execa } from "execa";

export interface PrepareWorkspaceInput {
  taskId: string;
  repo: string;
  baseBranch: string;
  workspaceRoot: string;
}

export interface PreparedWorkspace {
  taskId: string;
  worktreePath: string;
  branchName: string;
}

export interface WorkspaceManager {
  prepareWorkspace(input: PrepareWorkspaceInput): Promise<PreparedWorkspace>;
  collectDiff(worktreePath: string): Promise<string>;
  cleanup(taskId: string): Promise<void>;
}

export interface WorktreeManager {
  createWorktree(bareRepo: string, taskId: string, baseBranch: string, workspaceRoot: string): Promise<PreparedWorkspace>;
  collectDiff(worktreePath: string): Promise<string>;
  removeWorktree(worktreePath: string, branchName: string, bareRepo: string): Promise<void>;
}

export class GitWorktreeManager implements WorktreeManager {
  async createWorktree(
    bareRepo: string,
    taskId: string,
    baseBranch: string,
    workspaceRoot: string
  ): Promise<PreparedWorkspace> {
    const branchName = `feature/${taskId}`;
    const worktreePath = resolve(workspaceRoot, taskId, "repo");
    await mkdir(worktreePath, { recursive: true });

    await execa("git", ["-C", bareRepo, "worktree", "add", "-b", branchName, worktreePath, baseBranch]);

    return { taskId, worktreePath, branchName };
  }

  async collectDiff(worktreePath: string): Promise<string> {
    const result = await execa("git", ["-C", worktreePath, "diff", "--binary", "HEAD"]);
    return result.stdout;
  }

  async removeWorktree(worktreePath: string, branchName: string, bareRepo: string): Promise<void> {
    await execa("git", ["-C", bareRepo, "worktree", "remove", "-f", worktreePath]);
    try {
      await execa("git", ["-C", bareRepo, "branch", "-D", branchName]);
    } catch {
      // Branch may not exist
    }
  }
}

export class DefaultWorkspaceManager implements WorkspaceManager {
  private worktree: WorktreeManager;

  constructor(worktree?: WorktreeManager) {
    this.worktree = worktree ?? new GitWorktreeManager();
  }

  async prepareWorkspace(input: PrepareWorkspaceInput): Promise<PreparedWorkspace> {
    return this.worktree.createWorktree(input.repo, input.taskId, input.baseBranch, input.workspaceRoot);
  }

  async collectDiff(worktreePath: string): Promise<string> {
    return this.worktree.collectDiff(worktreePath);
  }

  async cleanup(taskId: string): Promise<void> {
    // Cleanup handled by caller with branch/bareRepo info
  }
}
