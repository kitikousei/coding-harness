import type { Command } from "commander";
import { resolve } from "path";
import { startDashboardServer } from "../../dashboard/server.js";

interface DashboardCommandOptions {
  port: string;
  host: string;
  artifactRoot: string;
  temporalAddress: string;
}

export function dashboardCommand(program: Command) {
  program
    .command("dashboard")
    .description("Start the local dashboard for observing existing Temporal workflows")
    .option("--port <port>", "Port to listen on", "8787")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--artifact-root <path>", "Task artifact root", resolve(process.cwd(), "artifacts/tasks"))
    .option("--temporal-address <address>", "Temporal address", process.env.TEMPORAL_ADDRESS || "localhost:7233")
    .action(async (opts: DashboardCommandOptions) => {
      const artifactRoot = resolve(process.cwd(), opts.artifactRoot);
      const server = await startDashboardServer({
        host: opts.host,
        port: Number(opts.port),
        artifactRoot,
        temporalAddress: opts.temporalAddress,
      });

      console.log(`Pi Agent dashboard: ${server.url}`);
      console.log(`Artifacts: ${artifactRoot}`);
      console.log(`Temporal: ${opts.temporalAddress}`);
    });
}
