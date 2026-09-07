import { Worker } from "@temporalio/worker";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import * as activities from "../activities/stage-activities.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const worker = await Worker.create({
    workflowsPath: resolve(__dirname, "../workflows/LongEngineeringTaskWorkflow.ts"),
    activities,
    taskQueue: "pi-agent-tasks",
  });

  console.log("Pi Agent Temporal Worker started (taskQueue: pi-agent-tasks)");
  console.log("Waiting for workflow tasks...");
  await worker.run();
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
