import type { Command } from "commander";
import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import { normalizeOptionalPath } from "../../tasks/TaskMetadata.js";

export function createTaskCommand(program: Command) {
  program
    .command("create-task")
    .description("Create a new task with input")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--repo <path>", "Repository path")
    .option("--base <branch>", "Base branch", "main")
    .option("--input <file>", "Input file path")
    .action(async (opts: any) => {
      const taskDir = resolve(process.cwd(), `artifacts/tasks/${opts.task}`);
      await mkdir(taskDir, { recursive: true });

      const taskJson = {
        id: opts.task,
        repo: normalizeOptionalPath(opts.repo),
        baseBranch: opts.base || "main",
        createdAt: new Date().toISOString(),
        status: "created",
      };
      await writeFile(resolve(taskDir, "task.json"), JSON.stringify(taskJson, null, 2) + "\n");

      if (opts.input) {
        const { readFile } = await import("fs/promises");
        const inputContent = await readFile(resolve(process.cwd(), opts.input), "utf-8");
        await writeFile(resolve(taskDir, "input.md"), inputContent);
      } else {
        await writeFile(resolve(taskDir, "input.md"), "# Task Input\n\nNo input provided.");
      }

      console.log(`Task ${opts.task} created at ${taskDir}`);
    });
}
