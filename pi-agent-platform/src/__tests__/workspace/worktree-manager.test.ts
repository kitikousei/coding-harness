import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm } from "fs/promises";
import { resolve } from "path";
import { GitWorktreeManager } from "../../workspace/WorkspaceManager.js";

describe("GitWorktreeManager", () => {
  const testDir = resolve(process.cwd(), "test-worktree-tmp");
  let bareRepo: string;

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    bareRepo = resolve(testDir, "bare-repo");
    await mkdir(bareRepo);
    // Init a git repo
    const { execa } = await import("execa");
    await execa("git", ["init", "-b", "main"], { cwd: bareRepo });
    await execa("git", ["config", "user.email", "test@test.com"], { cwd: bareRepo });
    await execa("git", ["config", "user.name", "Test"], { cwd: bareRepo });
    // Create a commit (need at least one file)
    await execa("git", ["commit", "--allow-empty", "-m", "init"], { cwd: bareRepo });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates a worktree", async () => {
    const manager = new GitWorktreeManager();
    const ws = await manager.createWorktree(bareRepo, "TASK-WT-001", "main", testDir);
    expect(ws.taskId).toBe("TASK-WT-001");
    expect(ws.branchName).toBe("feature/TASK-WT-001");
    expect(ws.worktreePath).toContain("TASK-WT-001");
  });

  it("collects diff from worktree", async () => {
    const manager = new GitWorktreeManager();
    const ws = await manager.createWorktree(bareRepo, "TASK-WT-002", "main", testDir);
    const { writeFile } = await import("fs/promises");
    await writeFile(resolve(ws.worktreePath, "newfile.txt"), "hello\n", "utf-8");
    const { execa } = await import("execa");
    await execa("git", ["add", "."], { cwd: ws.worktreePath });
    const diff = await manager.collectDiff(ws.worktreePath);
    expect(diff).toContain("newfile.txt");
  });
});
