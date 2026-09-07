import { mkdir, writeFile, readFile } from "fs/promises";
import { dirname, resolve } from "path";
import { execa } from "execa";
import type { AgentRuntime, AgentRunInput, AgentRunResult } from "./AgentRuntime.js";

/**
 * Pi CLI runner: executes stages by calling the `pi` CLI in non-interactive mode.
 * This replaces MockRuntime's hardcoded fake outputs with real AI-driven execution.
 */

const DEFAULT_TIMEOUT_MS = 600_000;

const MOCK_OUTPUTS: Record<string, Record<string, any>> = {
  normalize_requirements: {
    "requirements.json": {
      background: "Demo project for MVP.",
      goals: ["Add a utility function"],
      non_goals: ["UI changes"],
      functional_requirements: ["Implement the requested feature"],
      non_functional_requirements: ["Keep code clean"],
      constraints: ["Use existing patterns"],
      acceptance_criteria: ["Tests pass"],
      open_questions: []
    },
    "requirements.md": "# Requirements\n\nThis is a mock requirements document for the MVP stage.\n\n## Background\nDemo project.\n\n## Goals\nAdd utility function.\n\n## Non-Goals\nNone.\n\n## Constraints\nNone.\n\n## Acceptance Criteria\nTests pass."
  },
  analyze_requirements: {
    "requirement-analysis.md": "# Requirement Analysis\n\nThe requirements are clear and feasible.\n\n## Feasibility\nHigh.\n\n## Complexity\nLow.\n\n## Dependencies\nNone required."
  },
  codegraph_impact: {
    "codegraph-impact.json": {
      entrypoints: ["src/index.ts"],
      symbols: ["slugify"],
      callers: [],
      callees: [],
      affected_files: ["src/utils/slugify.ts", "src/utils/slugify.test.ts"],
      test_targets: ["src/utils/slugify.test.ts"],
      risks: [{ level: "low", description: "New function, low risk" }]
    },
    "codegraph-impact.md": "# CodeGraph Impact Analysis\n\n## Affected Files\n- src/utils/slugify.ts\n- src/utils/slugify.test.ts"
  },
  write_implementation_plan: {
    "implementation-plan.json": {
      summary: "Create a slugify utility function.",
      files_to_change: [
        { path: "src/utils/slugify.ts", reason: "New function", change_type: "create" },
        { path: "src/utils/slugify.test.ts", reason: "Unit tests", change_type: "create" }
      ],
      steps: ["Create slugify.ts", "Create slugify.test.ts", "Run tests"],
      test_strategy: ["Unit test all edge cases"],
      risks: ["None identified"],
      rollback: "Delete the created files."
    },
    "implementation-plan.md": "# Implementation Plan\n\nCreate a slugify utility function with tests."
  },
  write_tests: {
    "test-cases.json": {
      cases: [
        { name: "basic slugify", requirement: "FR-1", type: "unit", expected: "hello-world" }
      ]
    },
    "test-cases.md": "# Test Cases\n\n## Unit Tests\n- basic slugify: hello world -> hello-world",
    "diff.patch": "diff --git a/src/utils/slugify.test.ts b/src/utils/slugify.test.ts\nnew file mode 100644"
  },
  implement_code: {
    "implementation-notes.md": "# Implementation Notes\n\nCreated slugify utility function.\n\n## Changed Files\n- src/utils/slugify.ts\n- src/utils/slugify.test.ts",
    "diff.patch": "diff --git a/src/utils/slugify.ts b/src/utils/slugify.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/utils/slugify.ts\n@@ -0,0 +1,5 @@\n+export function slugify(input: string): string {\n+  return input.trim().toLowerCase().replace(/\\\\s+/g, '-').replace(/^-+|-+$/g, '');\n+}"
  },
  fix_test_failures: {
    "fix-attempt-${attempt}.md": "# Fix Attempt ${attempt}\n\nFixed the test failure by updating the slugify implementation.",
    "diff.patch": "diff --git a/src/utils/slugify.ts b/src/utils/slugify.ts\n--- a/src/utils/slugify.ts\n+++ b/src/utils/slugify.ts\n@@ -1,3 +1,3 @@\n export function slugify(input: string): string {\n-  return input.trim().toLowerCase().replace(/\\\\\\\\s+/g, '-');\n+  return input.trim().toLowerCase().replace(/\\\\\\\\s+/g, '-').replace(/^-+|-+$/g, '');\n }"
  },
  review_diff: {
    "review.md": "# Code Review\n\n## Summary\nThe changes look good and follow the plan.\n\n## Quality\nCode is clean and well-tested.\n\n## Recommendation\nApprove."
  },
  publish_final_report: {
    "final-report.json": {
      task_id: "${taskId}",
      status: "completed",
      summary: "Successfully implemented the feature.",
      changed_files: ["src/utils/slugify.ts", "src/utils/slugify.test.ts"],
      test_commands: ["pnpm test"],
      test_passed: true,
      risks: ["None identified"]
    },
    "final-report.md": "# Final Report\n\n## Summary\nSuccessfully implemented the feature.\n\n## Changed Files\n- src/utils/slugify.ts\n- src/utils/slugify.test.ts\n\n## Test Results\nAll tests passed.\n\n## Risks\nNone identified."
  }
};

/**
 * Parse the final agent_end event from pi --mode json --print output.
 * Returns the assistant text response and any tool call info.
 */
export function parsePiJsonlOutput(stdout: string): {
  assistantText: string;
  toolCalls: Array<{ name: string; args: string }>;
  toolErrors: string[];
  turnCount: number;
  hasAssistantResponse: boolean;
  usage: { inputTokens: number; outputTokens: number };
} {
  const toolCalls: Array<{ name: string; args: string }> = [];
  const toolErrors: string[] = [];
  let assistantText = "";
  let turnCount = 0;
  let hasAssistantResponse = false;
  let usage = { inputTokens: 0, outputTokens: 0 };

  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    try {
      const evt = JSON.parse(line);

      if (evt.type === "tool_execution_end" && evt.isError) {
        const text = evt.result?.content?.[0]?.text || JSON.stringify(evt.result);
        toolErrors.push(text);
      }

      if (evt.type === "turn_end") {
        turnCount++;
      }

      if (evt.type === "message_update") {
        const a = evt.assistantMessageEvent;
        if (a?.type === "text_delta" && a.delta) {
          assistantText += a.delta;
          hasAssistantResponse = true;
        }
        if (a?.type === "toolcall_delta" && a.delta) {
          toolCalls[toolCalls.length - 1] = {
            ...toolCalls[toolCalls.length - 1],
            args: (toolCalls[toolCalls.length - 1]?.args || "") + a.delta
          };
        }
        if (a?.type === "toolcall_start") {
          toolCalls.push({ name: evt.assistantMessageEvent?.toolName || "", args: "" });
        }
      }

      if (evt.type === "message_end" && evt.message?.role === "assistant") {
        const u = evt.message.usage;
        if (u) {
          usage.inputTokens += Number(u.inputTokens ?? u.input ?? u.input_tokens ?? 0);
          usage.outputTokens += Number(u.outputTokens ?? u.output ?? u.output_tokens ?? 0);
        }
      }

      if (evt.type === "agent_end") {
        const msgs = evt.messages || [];
        for (const msg of msgs) {
          if (msg.role === "assistant") {
            const textParts = msg.content?.filter((c: any) => c.type === "text") || [];
            for (const part of textParts) {
              if (part.text && !msg.content?.some((c: any) => c.type === "thinking")) {
                assistantText = part.text;
              }
            }
          }
          if (msg.role === "toolResult" && msg.isError) {
            const text = msg.content?.[0]?.text || JSON.stringify(msg);
            if (!toolErrors.includes(text)) toolErrors.push(text);
          }
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return { assistantText, toolCalls, toolErrors, turnCount, hasAssistantResponse, usage };
}

export class MockRuntime implements AgentRuntime {
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    // Check if Pi CLI is available for real execution
    const piMode = process.env.PI_AGENT_MODE || "mock";

    if (piMode === "pi-cli") {
      return this.runWithPiCli(input);
    }

    // Fallback to mock outputs
    return this.runWithMockOutputs(input);
  }

  private async runWithPiCli(input: AgentRunInput): Promise<AgentRunResult> {
    const artifactRoot = resolve(input.cwd, `artifacts/tasks/${input.taskId}`);
    await mkdir(artifactRoot, { recursive: true });

    // Build the prompt that tells Pi what to do
    const piPrompt = this.buildPiPrompt(input, artifactRoot);

    const args = [
      "--mode", "json",
      "--print",
      "--no-session",
      "--tools", "read,write,bash,edit,grep,find,ls",
      "--",
      piPrompt,
    ];

    try {
      const result = await execa("pi", args, {
        cwd: input.cwd || process.cwd(),
        reject: false,
        timeout: 0, // No timeout — let Temporal's startToCloseTimeout handle it
      });

      const { assistantText, toolErrors, turnCount, hasAssistantResponse, usage } =
        parsePiJsonlOutput(result.stdout);

      // Save stderr log
      const stderrLog = resolve(artifactRoot, `${input.stage}.stderr.log`);
      await mkdir(dirname(stderrLog), { recursive: true });
      await writeFile(stderrLog, result.stderr || "", "utf-8");

      if (result.exitCode !== 0) {
        return {
          status: "failed",
          summary: `Pi exited with code ${result.exitCode}`,
          logFile: stderrLog,
          error: {
            type: "agent_exit_error",
            message: result.stderr || result.stdout,
            retryable: true,
          },
        };
      }

      if (toolErrors.length > 0) {
        return {
          status: "failed",
          summary: `Pi encountered ${toolErrors.length} tool error(s)`,
          logFile: stderrLog,
          error: {
            type: "tool_execution_error",
            message: toolErrors.join("\n"),
            retryable: true,
          },
        };
      }

      if (!hasAssistantResponse && turnCount === 0) {
        return {
          status: "failed",
          summary: "Pi produced no assistant response",
          logFile: stderrLog,
          error: {
            type: "invalid_agent_output",
            message: "No assistant messages found in JSONL output",
            retryable: false,
          },
        };
      }

      return {
        status: "succeeded",
        summary: `Pi CLI completed (${turnCount} turn(s)): ${assistantText.slice(0, 200)}`,
        logFile: stderrLog,
        usage,
      };
    } catch (err: any) {
      return {
        status: "failed",
        summary: `Pi execution failed: ${err.message}`,
        error: {
          type: "agent_execution_error",
          message: err.message,
          retryable: err.code === "ENOENT" ? false : true,
        },
      };
    }
  }

  private buildPiPrompt(input: AgentRunInput, artifactRoot: string): string {
    const stageInstructions: Record<string, string> = {
      normalize_requirements: `You are running the normalize_requirements stage for task ${input.taskId}.
Read the input file at ${artifactRoot}/input.md (if it exists) or use the task context.
Produce TWO files:
1. ${artifactRoot}/requirements.json with fields: background, goals, non_goals, functional_requirements, non_functional_requirements, constraints, acceptance_criteria, open_questions
2. ${artifactRoot}/requirements.md with sections: Background, Goals, Non-Goals, Constraints, Acceptance Criteria, Open Questions
Write ONLY to these paths. Do NOT modify any source code files.`,

      analyze_requirements: `You are running the analyze_requirements stage for task ${input.taskId}.
Read ${artifactRoot}/requirements.json if it exists.
Produce ${artifactRoot}/requirement-analysis.md with sections: Feasibility, Complexity, Dependencies, Risks.
Write ONLY to this path. Do NOT modify any source code files.`,

      codegraph_impact: `You are running the codegraph_impact stage for task ${input.taskId}.
Read ${artifactRoot}/requirements.json and ${artifactRoot}/requirement-analysis.md.
Run codegraph commands if available, or analyze the code structure manually.
Produce:
1. ${artifactRoot}/codegraph-impact.json with fields: entrypoints, symbols, callers, callees, affected_files, test_targets, risks
2. ${artifactRoot}/codegraph-impact.md
Write ONLY to these paths. Do NOT modify any source code files.`,

      write_implementation_plan: `You are running the write_implementation_plan stage for task ${input.taskId}.
Read ${artifactRoot}/requirements.json and ${artifactRoot}/codegraph-impact.json.
Produce:
1. ${artifactRoot}/implementation-plan.json with fields: summary, files_to_change, steps, test_strategy, risks, rollback
2. ${artifactRoot}/implementation-plan.md
Write ONLY to these paths. Do NOT modify any source code files.`,

      write_tests: `You are running the write_tests stage for task ${input.taskId}.
Read ${artifactRoot}/requirements.json and ${artifactRoot}/implementation-plan.json.
Write test files in the project's test directory following existing patterns.
Produce:
1. ${artifactRoot}/test-cases.json with cases array
2. ${artifactRoot}/test-cases.md
3. Run "git diff --binary HEAD > ${artifactRoot}/diff.patch" to capture the diff.
You may create/modify test source files in the workspace.`,

      implement_code: `You are running the implement_code stage for task ${input.taskId}.
Read ${artifactRoot}/requirements.json, ${artifactRoot}/codegraph-impact.json, and ${artifactRoot}/implementation-plan.json.
Implement the code changes according to the plan.
After making changes:
1. Run "git diff --binary HEAD > ${artifactRoot}/diff.patch" to capture the diff.
2. Write ${artifactRoot}/implementation-notes.md listing changed files and key decisions.
You may create/modify source files in the workspace.`,

      fix_test_failures: `You are running the fix_test_failures stage for task ${input.taskId}.
Read ${artifactRoot}/test-result.json and the test output logs.
Fix the failing tests by modifying source or test files.
After fixing:
1. Run "git diff --binary HEAD > ${artifactRoot}/diff.patch"
2. Write ${artifactRoot}/fix-attempt-${input.context?.attempt ?? 1}.md describing the fix.
You may create/modify source files in the workspace.`,

      review_diff: `You are running the review_diff stage for task ${input.taskId}.
Read ${artifactRoot}/diff.patch and ${artifactRoot}/implementation-plan.json.
Produce ${artifactRoot}/review.md with sections: Summary, Quality, Issues Found, Recommendation.
Write ONLY to this path. Do NOT modify any source code files.`,

      publish_final_report: `You are running the publish_final_report stage for task ${input.taskId}.
Read all existing artifact files in ${artifactRoot}/.
Produce:
1. ${artifactRoot}/final-report.json with fields: task_id, status, summary, changed_files, test_commands, test_passed, risks
2. ${artifactRoot}/final-report.md with sections: Summary, Changed Files, Test Results, Risks
Write ONLY to these paths. Do NOT modify any source code files.`,
    };

    return stageInstructions[input.stage] || `Execute the ${input.stage} stage for task ${input.taskId}.`;
  }

  private async runWithMockOutputs(input: AgentRunInput): Promise<AgentRunResult> {
    const outputs = MOCK_OUTPUTS[input.stage];
    if (!outputs) {
      return {
        status: "failed",
        summary: `No mock output defined for stage: ${input.stage}`,
        error: { type: "mock_not_configured", message: `No mock data for stage ${input.stage}`, retryable: false }
      };
    }

    const artifactRoot = resolve(input.cwd, `artifacts/tasks/${input.taskId}`);
    await mkdir(artifactRoot, { recursive: true });

    const writtenFiles: string[] = [];
    for (const [filename, content] of Object.entries(outputs)) {
      const resolvedFilename = filename.replace("${taskId}", input.taskId).replace("${attempt}", String((input as any).context?.attempt ?? 1));
      const targetPath = resolve(artifactRoot, resolvedFilename);
      const fileContent = typeof content === "string"
        ? content.replaceAll("${taskId}", input.taskId)
        : JSON.stringify(content, null, 2).replaceAll("${taskId}", input.taskId) + "\n";
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, fileContent, "utf-8");
      writtenFiles.push(resolvedFilename);
    }

    return {
      status: "succeeded",
      summary: `Mock outputs written for stage ${input.stage}: ${writtenFiles.join(", ")}`,
      outputArtifacts: writtenFiles,
      usage: { inputTokens: 0, outputTokens: 0 }
    };
  }
}
