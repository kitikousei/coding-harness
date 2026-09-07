# MVP-2 Runtime、Workspace、Workflow 实施方案

日期：2026-09-03

## 1. 目标

MVP-2 把前两阶段的协议接入真实执行链路。优先用 `MockRuntime` 跑通端到端，再接入 `PiAgentRuntime` 调用本机 Pi Agent 的只读阶段，最后接入 Temporal workflow 和 workspace/test runner。

## 2. 交付文件

建议创建：

```text
apps/pi-agent-platform/
  src/
    agent-runtimes/
      AgentRuntime.ts
      MockRuntime.ts
      PiAgentRuntime.ts
      PiCliRuntime.ts
    stages/
      runStage.ts
      buildPrompt.ts
      StageResult.ts
    workspace/
      WorkspaceManager.ts
      WorktreeManager.ts
    testing/
      TestCommandResolver.ts
      TestRunner.ts
    workflows/
      LongEngineeringTaskWorkflow.ts
    activities/
      stage-activities.ts
      workspace-activities.ts
      test-activities.ts
      report-activities.ts
    cli/
      index.ts
      commands/
        create-task.ts
        run-stage.ts
        run-mvp.ts
    __tests__/
      agent-runtimes/
        mock-runtime.test.ts
        pi-agent-runtime.test.ts
      stages/
        run-stage.test.ts
        build-prompt.test.ts
      workspace/
        worktree-manager.test.ts
      testing/
        test-command-resolver.test.ts
        test-runner.test.ts
      workflows/
        long-engineering-task-workflow.test.ts
```

## 3. AgentRuntime 接口

`AgentRuntime.ts`：

```ts
export interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export interface AgentRunInput {
  taskId: string;
  stage: string;
  cwd: string;
  prompt: string;
  promptFile?: string;
  sandbox: "read-only" | "workspace-write" | "full-access";
  tools: string[];
  mcpServers?: AgentMCPServerConfig[];
  outputSchema?: string;
  outputFile?: string;
  artifactRoot?: string;
  allowedOutputPaths?: string[];
  timeoutMs?: number;
  maxToolCallsPerRun?: number;
  context?: Record<string, unknown>;
}

export interface AgentRunResult {
  status: "succeeded" | "failed" | "needs_input";
  summary: string;
  outputFile?: string;
  logFile?: string;
  outputArtifacts?: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  error?: {
    type: string;
    message: string;
    retryable: boolean;
  };
}
```

## 4. MockRuntime

`MockRuntime` 用于先验证 workflow、manifest、artifact 和 validator，不依赖真实模型。

行为：

- `normalize_requirements` 写出合法 `requirements.json` 和 `requirements.md`。
- `codegraph_impact` 写出合法 `codegraph-impact.json` 和 `codegraph-impact.md`。
- `write_implementation_plan` 写出合法 `implementation-plan.json` 和 `implementation-plan.md`。
- `write_tests` 写出 `test-cases.json` 和 `test-cases.md`。
- `implement_code` 写出 `implementation-notes.md` 和 `diff.patch`，不修改真实代码。
- `fix_test_failures` 根据输入的 `test-result.json` 写出修复记录。
- `review_diff` 写出 `review.md`。
- `publish_final_report` 写出 `final-report.json` 和 `final-report.md`。

验证点：

```bash
pnpm vitest run src/__tests__/agent-runtimes/mock-runtime.test.ts
```

## 5. PiAgentRuntime

`PiAgentRuntime` 是 MVP 的真实执行器，负责通过 `@earendil-works/pi-coding-agent@0.83.0` SDK 创建 custom-agent session。它必须实现 `AgentRuntime` 接口，并把阶段 manifest 中的 sandbox、tool allowlist、prompt、artifact 输出约束和运行限制转换为 Pi SDK session 配置。

MVP 只要求先接入只读阶段：

```text
normalize_requirements
analyze_requirements
write_implementation_plan
```

实现要求：

- 通过 `createAgentSession()` 创建 session，使用 `SessionManager.inMemory(cwd)`，不复用默认会话历史。
- 使用 `DefaultResourceLoader`，并关闭默认 extensions、context files、skills、prompt templates、themes；系统提示词由平台显式注入。
- 平台 `read_file` 映射为 Pi `read`。
- 平台 `write_file` 映射为 Pi `write`。
- 平台 `patch` 映射为 Pi `edit`。
- 平台 `terminal` 映射为 Pi `bash`。
- 平台 `write_artifact` 映射为 custom tool，不映射到 Pi 内置 `write`。
- custom `write_artifact` 只允许写 `runStage()` 从 manifest outputs 解析出的 `allowedOutputPaths`。
- `runStage()` 必须把 `artifactRoot`、`allowedOutputPaths`、`constraints.maxDurationMs`、`constraints.maxToolCallsPerRun` 传给 runtime。
- SDK event stream 必须保存到 `artifacts/tasks/<task-id>/<stage>.events.jsonl`。
- 订阅 `agent_settled`、`message_end`、`tool_execution_start`、`tool_execution_end` 等事件，记录 usage、工具错误和工具调用数。
- 超时、工具调用超限、工具执行错误、无 assistant 输出必须返回结构化 `failed`。
- `codegraph-mcp` 不通过 MCP client 透传，而是把 `codegraph_context`、`codegraph_explore`、`codegraph_impact` 映射为只读 custom tools，内部调用本地 `codegraph` CLI 并固定 `--path <cwd>`。
- 非 CodeGraph 的 `mcpServers` 暂不在 SDK runtime 中透传；收到未知 MCP server 配置时返回 `mcp_not_supported`，避免静默忽略外部能力。
- 产物 schema 仍由 `OutputValidator` 在 agent run 后统一校验。

`PiCliRuntime` 作为兼容 adapter 保留，用于直接调用本机 `pi` CLI：

```bash
pi --mode json --print --no-session --tools read,grep,find,ls -- "<prompt>"
```

CLI 兼容模式只解析 JSON/JSONL 输出和 stderr 日志，不具备 SDK 事件订阅和 custom `write_artifact` 路径级控制。为避免 read-only 阶段通过 artifact 能力获得通用写权限，`PiCliRuntime` 不再把平台 `write_artifact` 映射到 Pi 内置 `write`。

测试策略：

- SDK 单元测试 mock `@earendil-works/pi-coding-agent`，验证 resource loader、session options、custom tool、事件处理和失败路径。
- CLI 兼容单元测试不调用真实 `pi`，通过 fake process runner 注入 stdout、stderr 和 exit code。
- 集成测试用环境变量开启：

```bash
RUN_PI_INTEGRATION=1 pnpm vitest run src/__tests__/agent-runtimes/pi-agent-runtime.test.ts
```

`CodexRuntime` 可以作为后续兼容 adapter 保留，但不进入 MVP 主路径。

## 6. runStage

`runStage.ts` 负责串起 MVP-0 的协议。

输入：

```ts
export interface RunStageInput {
  taskId: string;
  stage: string;
  worktreePath: string;
  artifactRoot: string;
  runtime: AgentRuntime;
  approvedOperations: SensitiveOperation[];
  context?: Record<string, unknown>;
}
```

输出：

```ts
export interface StageResult {
  taskId: string;
  stage: string;
  status: "succeeded" | "failed" | "blocked" | "needs_input";
  summary: string;
  outputArtifacts: string[];
  error?: {
    type: string;
    message: string;
    retryable: boolean;
  };
}
```

必须记录事件：

```text
stage.started
stage.warning
stage.completed
stage.failed
stage.blocked
```

测试命令：

```bash
pnpm vitest run src/__tests__/stages/run-stage.test.ts
```

运行要求：

- `runStage()` 加载 manifest 后，必须通过 `StageEnforcer.assertToolAllowed()` 校验最终传入 runtime 的工具集合。
- `runStage()` 解析 manifest outputs 为绝对路径 allowlist，传给 runtime 的 `allowedOutputPaths`。
- `${taskId}`、`${artifactRoot}` 和 `${attempt}` 占位符必须在传给 runtime 前替换完成。
- `constraints.maxDurationMs` 传给 runtime 的 `timeoutMs`。
- `constraints.maxToolCallsPerRun` 传给 runtime 的 `maxToolCallsPerRun`。

## 7. Workspace Manager

MVP 支持两种输入：

```text
local_repo_path：使用已有本地仓库创建 worktree
git_remote_url：clone 后创建 worktree
```

接口：

```ts
export interface WorkspaceManager {
  prepareWorkspace(input: PrepareWorkspaceInput): Promise<PreparedWorkspace>;
  collectDiff(worktreePath: string): Promise<string>;
  cleanup(taskId: string): Promise<void>;
}

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
```

分支名：

```text
feature/<task-id>
```

约束：

- 不在脏工作区直接修改代码。
- 如果 base repo 有未提交修改，创建任务失败并要求用户处理。
- worktree 路径固定为 `workspaces/<task-id>/repo`。
- `collectDiff()` 使用 `git diff --binary`，输出写入 `diff.patch`。

测试命令：

```bash
pnpm vitest run src/__tests__/workspace/worktree-manager.test.ts
```

## 8. Test Runner

`TestCommandResolver` 按项目文件识别命令：

| 文件 | 命令 |
| --- | --- |
| `package.json` 有 `test` script | `pnpm test`、`npm test` 或 `yarn test`，按 lockfile 决定 |
| `package.json` 有 `typecheck` script | 同包管理器运行 `typecheck` |
| `pyproject.toml` | `pytest` |
| `go.mod` | `go test ./...` |
| `Cargo.toml` | `cargo test` |

`TestRunner` 输出：

```text
artifacts/tasks/<task-id>/test-result.json
artifacts/tasks/<task-id>/test-output.log
```

测试失败时，workflow 进入修复循环：

```text
attempt 1 -> fix_test_failures -> run tests
attempt 2 -> fix_test_failures -> run tests
attempt 3 -> fix_test_failures -> run tests
failed -> tests_failed_needs_human
```

测试命令：

```bash
pnpm vitest run src/__tests__/testing
```

## 9. Temporal Workflow

Workflow 输入：

```ts
export interface TaskInput {
  taskId: string;
  title: string;
  repo: string;
  baseBranch: string;
  inputFile: string;
  approvalPolicy: "requirements_and_plan";
  testPolicy: "unit_tests_required";
  runtime: "mock" | "pi" | "pi-cli" | "codex";
}
```

Workflow 主路径：

```ts
export async function LongEngineeringTaskWorkflow(input: TaskInput) {
  const task = await activities.createTask(input);

  const requirements = await activities.runStage(task.id, "normalize_requirements");
  await waitForApproval("requirements", requirements);

  await activities.runStage(task.id, "analyze_requirements");
  await activities.runStage(task.id, "codegraph_impact");

  const plan = await activities.runStage(task.id, "write_implementation_plan");
  await waitForApproval("plan", plan);

  await activities.prepareWorkspace(task.id);
  await activities.runStage(task.id, "write_tests");
  await activities.runStage(task.id, "implement_code");

  for (let attempt = 1; attempt <= 3; attempt++) {
    const testResult = await activities.runTests(task.id);
    if (testResult.passed) {
      break;
    }
    await activities.runStage(task.id, "fix_test_failures", { attempt });
  }

  await activities.runStage(task.id, "review_diff");
  await activities.runStage(task.id, "publish_final_report");

  return { taskId: task.id, status: "completed" };
}
```

审批 signal：

```ts
export interface ApprovalSignal {
  taskId: string;
  stage: "requirements" | "plan" | "diff" | "pr";
  decision: "approved" | "rejected";
  comment?: string;
  reviewer: string;
  decidedAt: string;
}
```

MVP 验证：

- requirements 审批前 workflow 停止推进。
- plan 审批前 workflow 停止推进。
- reject 后 workflow 进入 failed，并记录 reject comment。
- worker 重启后，从 Temporal history 恢复到等待审批或下一阶段。

## 10. CLI POC

最小命令：

```bash
pnpm pi-agent-platform create-task \
  --task TASK-MVP-001 \
  --repo /path/to/demo-repo \
  --base main \
  --input ./fixtures/slugify-requirement.md

pnpm pi-agent-platform run-mvp \
  --task TASK-MVP-001 \
  --runtime mock

pnpm pi-agent-platform approve \
  --task TASK-MVP-001 \
  --stage requirements

pnpm pi-agent-platform approve \
  --task TASK-MVP-001 \
  --stage plan
```

本地 POC 可以先不用 Web UI。CLI 能完成创建、审批、运行和查看状态后，再考虑 extension 面板。

## 11. MVP-2 完成标准

运行：

```bash
pnpm vitest run src/__tests__/agent-runtimes src/__tests__/stages src/__tests__/workspace src/__tests__/testing src/__tests__/workflows
```

随后执行：

```bash
pnpm pi-agent-platform run-mvp --task TASK-MVP-001 --runtime mock
```

期望：

- `artifacts/tasks/TASK-MVP-001/final-report.md` 存在。
- `artifacts/tasks/TASK-MVP-001/events.jsonl` 有完整阶段事件。
- `artifacts/tasks/TASK-MVP-001/diff.patch` 存在。
- `artifacts/tasks/TASK-MVP-001/test-output.log` 存在。
- workflow 等待审批时不会继续执行后续阶段。
- worker 重启后任务状态可恢复。

PiAgentRuntime 只读阶段验收：

```bash
RUN_PI_INTEGRATION=1 pnpm pi-agent-platform run-stage --stage normalize_requirements --task TASK-MVP-001 --runtime pi
RUN_PI_INTEGRATION=1 pnpm pi-agent-platform run-stage --stage write_implementation_plan --task TASK-MVP-001 --runtime pi
```

期望：

- 产物通过 schema 校验。
- SDK events 被保存。
- 超时、工具超限、工具错误或 MCP 未支持会生成明确失败事件。
