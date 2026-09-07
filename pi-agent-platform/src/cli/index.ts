import { Command } from "commander";
import { createTaskCommand } from "./commands/create-task.js";
import { runStageCommand } from "./commands/run-stage.js";
import { runMvpCommand } from "./commands/run-mvp.js";
import { workflowCommands } from "./commands/workflow.js";
import { approveCommand } from "./commands/approve.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { codegraphCommand } from "../codegraph/CodeGraphCLI.js";

const program = new Command();

program
  .name("pi-agent-platform")
  .description("Pi Agent MVP Platform CLI")
  .version("0.1.0");

createTaskCommand(program);
runStageCommand(program);
runMvpCommand(program);
workflowCommands(program);
approveCommand(program);
dashboardCommand(program);
codegraphCommand(program);

program.parse();
