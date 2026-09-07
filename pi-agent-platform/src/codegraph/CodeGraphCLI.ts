import { Command } from "commander";
import { execa } from "execa";
import { resolve } from "path";
import { access } from "fs/promises";

export interface CodeGraphResult {
  success: boolean;
  output: string;
  error?: string;
  command: string;
}

function findCodeGraphPath(startPath: string): string {
  // Check if codegraph is available
  return "codegraph";
}

async function assertCodeGraphIndexAvailable(path: string): Promise<string> {
  const dbPath = resolve(path, ".codegraph", "codegraph.db");
  try {
    await access(dbPath);
    return dbPath;
  } catch {
    throw new Error(`CodeGraph index not found at ${dbPath}. Run 'codegraph init -i ${path}' first.`);
  }
}

async function runCodeGraphCommand(
  cwd: string,
  subcommand: string,
  args: string[],
  query: string
): Promise<CodeGraphResult> {
  const fullArgs = [subcommand, "--path", cwd, ...args];
  if (query) fullArgs.push(query);

  try {
    const result = await execa("codegraph", fullArgs, {
      cwd,
      reject: false,
      timeout: 60_000,
    });

    return {
      success: result.exitCode === 0,
      output: result.stdout || result.stderr || "",
      error: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
      command: `codegraph ${fullArgs.join(" ")}`,
    };
  } catch (err: any) {
    return {
      success: false,
      output: "",
      error: err.message,
      command: `codegraph ${fullArgs.join(" ")}`,
    };
  }
}

export function codegraphCommand(program: Command) {
  const cmd = program
    .command("codegraph")
    .description("Analyze code using CodeGraph for code reading and impact analysis");

  cmd
    .command("explore")
    .description("Explore an area: relevant symbols' source + call paths in one shot")
    .requiredOption("-p, --path <path>", "Project path")
    .requiredOption("-q, --query <query>", "Natural language query to explore")
    .option("--max-files <n>", "Maximum number of files to include source from", "10")
    .action(async (opts: any) => {
      await assertCodeGraphIndexAvailable(opts.path);
      const result = await runCodeGraphCommand(opts.path, "explore", ["--max-files", opts.maxFiles], opts.query);
      console.log(result.output);
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("context")
    .description("Build context for a task: relevant symbols, relationships, and code blocks")
    .requiredOption("-p, --path <path>", "Project path")
    .requiredOption("-q, --query <query>", "Task description")
    .option("--max-nodes <n>", "Maximum number of symbols to include", "50")
    .option("--no-code", "Exclude code blocks from output")
    .action(async (opts: any) => {
      await assertCodeGraphIndexAvailable(opts.path);
      const args = ["--max-nodes", opts.maxNodes];
      if (opts.code === false) args.push("--no-code");
      const result = await runCodeGraphCommand(opts.path, "context", args, opts.query);
      console.log(result.output);
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("impact")
    .description("Analyze what code is affected by changing a symbol")
    .requiredOption("-p, --path <path>", "Project path")
    .requiredOption("-s, --symbol <symbol>", "Symbol name to analyze")
    .option("--depth <n>", "Traversal depth", "3")
    .option("--json", "Return JSON output")
    .action(async (opts: any) => {
      await assertCodeGraphIndexAvailable(opts.path);
      const args = ["--depth", opts.depth];
      if (opts.json) args.push("--json");
      const result = await runCodeGraphCommand(opts.path, "impact", args, opts.symbol);
      console.log(result.output);
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("callers")
    .description("Find all functions/methods that call a specific symbol")
    .requiredOption("-p, --path <path>", "Project path")
    .requiredOption("-s, --symbol <symbol>", "Symbol name")
    .action(async (opts: any) => {
      await assertCodeGraphIndexAvailable(opts.path);
      const result = await runCodeGraphCommand(opts.path, "callers", [], opts.symbol);
      console.log(result.output);
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("callees")
    .description("Find all functions/methods that a specific symbol calls")
    .requiredOption("-p, --path <path>", "Project path")
    .requiredOption("-s, --symbol <symbol>", "Symbol name")
    .action(async (opts: any) => {
      await assertCodeGraphIndexAvailable(opts.path);
      const result = await runCodeGraphCommand(opts.path, "callees", [], opts.symbol);
      console.log(result.output);
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("query")
    .description("Search for symbols in the codebase")
    .requiredOption("-p, --path <path>", "Project path")
    .requiredOption("-q, --query <query>", "Symbol name or pattern to search")
    .action(async (opts: any) => {
      await assertCodeGraphIndexAvailable(opts.path);
      const result = await runCodeGraphCommand(opts.path, "query", [], opts.query);
      console.log(result.output);
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("files")
    .description("Show project file structure from the index")
    .requiredOption("-p, --path <path>", "Project path")
    .action(async (opts: any) => {
      await assertCodeGraphIndexAvailable(opts.path);
      const result = await runCodeGraphCommand(opts.path, "files", [], "");
      console.log(result.output);
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("node")
    .description("One symbol's source + caller/callee trail")
    .requiredOption("-p, --path <path>", "Project path")
    .requiredOption("-s, --symbol <symbol>", "Symbol name")
    .action(async (opts: any) => {
      await assertCodeGraphIndexAvailable(opts.path);
      const result = await runCodeGraphCommand(opts.path, "node", [], opts.symbol);
      console.log(result.output);
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  cmd
    .command("status")
    .description("Show CodeGraph index status and statistics")
    .requiredOption("-p, --path <path>", "Project path")
    .action(async (opts: any) => {
      try {
        const result = await execa("codegraph", ["status", "--path", opts.path], {
          cwd: opts.path,
          reject: false,
          timeout: 30_000,
        });
        console.log(result.stdout || result.stderr || "");
      } catch (err: any) {
        console.error(`Failed to get status: ${err.message}`);
        process.exitCode = 1;
      }
    });

  cmd
    .command("init")
    .description("Initialize CodeGraph index in a project directory")
    .requiredOption("-p, --path <path>", "Project path")
    .action(async (opts: any) => {
      console.log(`Initializing CodeGraph index at ${opts.path}...`);
      try {
        const result = await execa("codegraph", ["init", "--path", opts.path], {
          cwd: opts.path,
          reject: false,
          timeout: 300_000,
          env: { ...process.env, CODEGRAPH_NO_WATCHDOG: "1", CODEGRAPH_TELEMETRY: "0" },
        });
        console.log(result.stdout || result.stderr || "");
        if (result.exitCode !== 0) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        console.error(`Failed to initialize: ${err.message}`);
        process.exitCode = 1;
      }
    });

  cmd
    .command("sync")
    .description("Sync CodeGraph index with recent changes")
    .requiredOption("-p, --path <path>", "Project path")
    .action(async (opts: any) => {
      try {
        await assertCodeGraphIndexAvailable(opts.path);
        const result = await execa("codegraph", ["sync", "--path", opts.path], {
          cwd: opts.path,
          reject: false,
          timeout: 120_000,
          env: { ...process.env, CODEGRAPH_NO_WATCHDOG: "1", CODEGRAPH_TELEMETRY: "0" },
        });
        console.log(result.stdout || result.stderr || "");
        if (result.exitCode !== 0) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        console.error(`Failed to sync: ${err.message}`);
        process.exitCode = 1;
      }
    });
}
