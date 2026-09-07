# Pi Agent 二开方案

日期：2026-09-03

## 1. 背景与目标

目标是将 Pi Agent 二次开发为一个面向软件工程长任务的 agent 平台，支持从需求输入、需求理解、代码影响分析、改造计划、测试用例、代码实现、单元测试到最终报告的完整闭环。

该方案不假设当前仓库已有完整 Pi Agent 代码实现。当前工作区仅存在方案文档，因此本文以平台化二开架构为主，重点定义边界、模块、流程、接口、落地阶段和风险控制。

## 2. 总体推荐

推荐采用“Pi Agent 作为交互与执行入口和本机 agent 执行环境，Temporal 作为可靠编排层，其他 coding agent 作为可选可插拔执行器，CodeGraph 作为代码理解工具”的架构。

核心原则：

```text
Pi Agent 管体验、扩展点和本机执行环境。
Temporal 管长任务状态。
PiAgentRuntime / coding agent adapter 干工程任务。
CodeGraph 懂代码结构。
Git worktree 隔离代码变更。
Artifact Store 沉淀过程产物。
```

不建议直接把所有能力塞进 Pi Agent 主进程。长任务天然涉及重试、暂停、恢复、人工审批、并发、日志和制品管理，这些更适合交给 Temporal 或类似工作流引擎。

## 3. 二开定位

Pi Agent 二开的合理定位不是“再造一个模型”，而是构建一个工程 agent 平台：

- 对用户：提供任务入口、状态展示、审批、报告和交互。
- 对 agent：提供统一任务协议、上下文、工具、权限和产物目录。
- 对代码仓库：提供 workspace、branch、worktree、测试命令和 CodeGraph 索引。
- 对平台：提供可靠调度、审计、权限、重试和观测。

## 4. 三种二开路线

### 4.1 轻量路线：本地增强版 Pi Agent

形态：

```text
Pi Agent CLI / Chat
  -> 本地 Markdown 任务目录
  -> CodeGraph MCP
  -> 手动 Git branch
  -> 本地测试命令
```

优点：

- 改造成本低。
- 适合个人或小团队。
- 不需要引入复杂基础设施。

缺点：

- 长任务恢复能力弱。
- 缺少平台化审批和审计。
- 并发任务容易互相影响。

适用场景：

- 个人研发效率工具。
- 内部试点。
- 验证 prompt、流程和产物格式。

### 4.2 推荐路线：Pi Agent + Temporal 工程长任务平台

形态：

```text
Pi Agent UI / API / CLI
  -> Task API
  -> Temporal Workflow
  -> Agent Runtime Adapter
      -> PiAgentRuntime
      -> Pi inline agent
      -> Codex
      -> Hermes
      -> future agents
  -> CodeGraph MCP
  -> Git Worktree Manager
  -> Test Runner
  -> Artifact Store
```

优点：

- 长任务可恢复。
- 有明确阶段和审批。
- 容易接 CI、PR、看板和报表。
- agent 执行器可替换。

缺点：

- 需要维护 Worker、队列和制品存储。
- 初期工程量更高。

适用场景：

- 团队级研发平台。
- 要接入任务看板、审批、测试报告和 PR 流程。
- 需要批量处理需求或 issue。

### 4.3 重型路线：多 agent 工程操作系统

形态：

```text
Pi Agent Platform
  -> 多租户
  -> 多仓库
  -> 多 agent 调度
  -> 权限系统
  -> 审计系统
  -> 策略引擎
  -> 任务市场 / 技能市场
```

优点：

- 平台能力完整。
- 适合多个团队统一使用。

缺点：

- 建设周期长。
- 需要治理模型、权限、成本、并发和安全。
- 容易过早复杂化。

适用场景：

- 公司级 AI 工程平台。
- 已经验证轻量版和推荐版有效。

建议先做 4.2，不直接跳到 4.3。

## 5. 目标架构

```text
                  +----------------------+
                  |  Pi Agent Frontdoor  |
                  |  UI / CLI / API      |
                  +----------+-----------+
                             |
                             v
                  +----------------------+
                  |  Task Service        |
                  |  Auth / Task / ACL   |
                  +----------+-----------+
                             |
                             v
                  +----------------------+
                  |  Temporal Workflow   |
                  |  State / Retry / SLA |
                  +----------+-----------+
                             |
       +---------------------+---------------------+
       |                     |                     |
       v                     v                     v
+-------------+      +----------------+     +----------------+
| Agent       |      | Workspace      |     | Artifact       |
| Runtime     |      | Manager        |     | Store          |
| Adapter     |      | Git Worktree   |     | Docs / Logs    |
+------+------+      +-------+--------+     +-------+--------+
       |                     |                      |
       v                     v                      v
+-------------+      +----------------+     +----------------+
| PiAgent     |      | Code Repo      |     | Reports        |
| Runtime /   |      | Branch / PR    |     | Test Output    |
| Other Agent |      | Tests          |     | Diffs          |
+-------------+      +----------------+     +----------------+
       |
       v
+-------------+
| CodeGraph   |
| MCP / Index |
+-------------+
```

## 6. 核心模块

### 6.1 Task Service

职责：

- 接收用户需求。
- 创建任务 ID。
- 管理任务元数据。
- 暴露任务状态查询接口。
- 接收审批、取消、重试等操作。
- 将任务启动请求投递给 Temporal。

核心接口：

```http
POST /tasks
GET /tasks/{taskId}
GET /tasks/{taskId}/events
POST /tasks/{taskId}/approve
POST /tasks/{taskId}/reject
POST /tasks/{taskId}/cancel
POST /tasks/{taskId}/retry
```

### 6.2 Workflow Orchestrator

建议使用 Temporal。

职责：

- 定义长任务状态机。
- 调度 Activity。
- 管理超时和重试。
- 等待人工审批。
- 支持任务恢复。
- 支持子 Workflow 并行。

核心 Workflow：

```text
LongEngineeringTaskWorkflow
RequirementWorkflow
CodeAnalysisWorkflow
ImplementationWorkflow
TestingWorkflow
ReviewWorkflow
ReportWorkflow
```

### 6.3 Agent Runtime Adapter

这是 Pi Agent 二开的关键抽象。

不要让业务流程直接依赖某一个 agent CLI 或 SDK。应定义统一执行接口：

```ts
interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

interface AgentRunInput {
  taskId: string;
  stage: string;
  cwd: string;
  prompt: string;
  promptFile?: string;
  sandbox: "read-only" | "workspace-write" | "full-access";
  tools: string[];
  outputSchema?: string;
  outputFile?: string;
}

interface AgentRunResult {
  status: "succeeded" | "failed" | "needs_input";
  summary: string;
  outputFile?: string;
  logFile?: string;
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

第一批适配器：

```text
PiAgentRuntime
CodexRuntime
PiInlineRuntime
HermesRuntime
MockRuntime
```

其中：

- `PiAgentRuntime` 用于调用本机安装的 Pi Agent，是 MVP 的真实执行主路径。
- `CodexRuntime` 用于兼容 Codex CLI 或 SDK，是可选外部 coding agent adapter。
- `PiInlineRuntime` 用于当前会话内轻量任务。
- `HermesRuntime` 用于兼容已有 Hermes 流程。
- `MockRuntime` 用于测试 Workflow。

### 6.4 Tool Registry & Capability Sources

职责：

- 管理三类能力来源：Native Tools、MCP Servers、Skills。
- 定义每个阶段允许使用的工具。
- 控制工具权限和沙箱级别。
- 管理 MCP Server 的生命周期（启动、连接、超时、重试）。
- 管理 Skill 的加载、注入和依赖检查。

#### 6.4.1 能力来源分类

```text
Native Tools    AgentRuntime 内置工具（read_file, write_file, terminal, web_search...）
MCP Servers     外部协议服务（CodeGraph MCP、GitHub MCP、Database MCP...）
Skills          可插拔知识库（SKILL.md + references/scripts/templates）
```

#### 6.4.2 MCP Server 管理

每个 MCP Server 声明：

```ts
interface MCPServer {
  id: string;                    // "codegraph-mcp"
  command: string;               // 启动命令
  args: string[];                // 启动参数
  env?: Record<string, string>;  // 环境变量
  tools: string[];               // 暴露的工具列表
  timeoutMs: number;             // 启动超时
  transport: "stdio" | "sse" | "http";
}
```

生命周期：

- 任务启动时按需启动 MCP Server（不在全局预启动）。
- 阶段结束后关闭未使用的 MCP Server。
- 连接失败时记录错误，不静默跳过。
- MCP 工具调用超时由 AgentRuntime 统一控制。

#### 6.4.3 Skill 管理

每个 Skill 声明：

```ts
interface StageSkill {
  name: string;              // "code-graphing", "test-driven-development"
  trigger: string;           // 自动加载的触发条件
  requiredBy?: string[];     // 依赖的其他 skill
  files?: string[];          // 需要注入的文件路径
  scripts?: string[];        // 需要执行的脚本
  injectAs: "prompt" | "context" | "tool";
}
```

加载规则：

- Skill 按阶段声明的列表加载，不全局加载所有 Skill。
- Skill 的 SKILL.md 内容注入到 agent 的 system prompt 或 context。
- Skill 引用的 references/templates/scripts 通过文件路径或 MCP 提供。
- Skill 加载失败不影响任务，但记录 warn 日志。

### 6.5 Workspace Manager

职责：

- 为每个任务创建独立 workspace。
- 创建 Git branch 或 worktree。
- 管理依赖安装。
- 运行测试。
- 收集 diff。
- 清理临时空间。

推荐目录：

```text
workspaces/
  TASK-123/
    repo/
    artifacts/
    logs/
```

推荐分支：

```text
feature/TASK-123-short-title
```

### 6.6 Artifact Store

职责：

- 保存所有阶段产物。
- 避免 Workflow history 膨胀。
- 支持审计和复盘。

产物结构：

```text
artifacts/tasks/<task-id>/
  input.md
  requirements.json
  requirements.md
  requirement-analysis.md
  codegraph-impact.json
  codegraph-impact.md
  implementation-plan.md
  test-cases.md
  implementation-notes.md
  diff.patch
  test-output.log
  review.md
  final-report.md
```

### 6.7 Approval Service

职责：

- 管理人工审批。
- 支持审批、驳回、补充说明。
- 将审批结果发送给 Temporal Workflow。

必须审批：

```text
需求理解审批
改造计划审批
```

建议审批：

```text
测试用例审批
代码 diff 审批
PR 创建审批
```

### 6.8 Test Runner

职责：

- 根据项目识别测试命令。
- 运行单元测试、集成测试、lint、typecheck。
- 保存日志。
- 输出结构化测试结果。

输出示例：

```json
{
  "passed": false,
  "commands": ["npm test", "npm run typecheck"],
  "failed_tests": [
    {
      "name": "should validate empty requirement",
      "message": "expected 400 but got 500"
    }
  ],
  "log_file": "artifacts/tasks/TASK-123/test-output.log"
}
```

### 6.9 Stage Capability Binding（阶段能力绑定）

这是把 6.4 Tool Registry 具体化的关键模块。每个阶段必须声明一份完整的 capability manifest，
由 AgentRuntime 在执行前校验并注入，确保 agent "只能看到该看的东西，只能做该做的事"。

#### 6.9.1 Capability Manifest 定义

每个阶段对应一个 manifest，格式：

```ts
interface StageCapabilityManifest {
  stage: string;

  // 工具：三类能力来源的统一白名单
  tools: {
    native: string[];       // Native Tool 白名单
    mcp: string[];          // 允许调用的 MCP 工具名（含 server 前缀，如 codegraph_impact）
    skills: string[];       // 需要加载的 Skill 名称
  };

  // MCP Server：按需启动
  mcpServers?: {
    id: string;
    required: boolean;      // true = 启动失败则 stage blocked; false = 可选
  }[];

  // 沙箱级别（约束 write / terminal 等行为）
  sandbox: "read-only" | "workspace-write" | "full-access";

  // 敏感操作：即使 sandbox 允许也需单独声明
  sensitiveOperations?: ("delete_file" | "install_dep" | "modify_ci" | "push_remote" | "create_pr")[];

  // Prompt 模板：必须加载的 prompt 文件
  promptTemplate: string;

  // 输出：期望的产物路径和 schema
  outputs: {
    path: string;
    schema?: string;       // JSON Schema 路径
    required: boolean;
  }[];

  // 执行约束
  constraints: {
    maxAgentRuns: number;          // 该阶段最多自动重试 agent 次数
    maxToolCallsPerRun: number;    // 单次 agent run 最多工具调用数（防 loop）
    maxDurationMs: number;         // 阶段超时
    allowSubagents: boolean;       // 是否允许启动 subagent
    requireOutputFile: boolean;    // 是否必须产出文件才算完成
    validateOutputSchema: boolean; // 是否校验输出 JSON Schema
  };
}
```

#### 6.9.2 各阶段能力绑定表

下表是 MVP 推荐配置，按阶段列出能力来源和约束：

| 阶段 | Skills | MCP Servers | Native Tools | Sandbox | 约束 |
|---|---|---|---|---|---|
| **需求提取** | humanizer | 无 | read_file, web_search, web_extract | read-only | 产出 requirements.md，不允许写文件 |
| **需求理解** | document-to-action-items | 无 | read_file, write_file | read-only | 产出 requirement-analysis.md |
| **CodeGraph 分析** | code-graphing | codegraph-mcp (required) | read_file, codegraph_* 系列 | read-only | MCP 不可用时 blocked；产出 impact.md + impact.json |
| **改造计划** | code-base-inspection | codegraph-mcp (optional) | read_file, write_file, search_files | read-only | 产出 implementation-plan.md；必须引用 impact.json |
| **测试用例** | test-driven-development | 无 | read_file, write_file, search_files | workspace-write | 产出 test-cases.md；允许在 test/ 目录创建文件 |
| **编码实现** | 无（或项目专属 skill） | 无 | read_file, write_file, patch, terminal（受限） | workspace-write | 严格按 plan 修改；不允许无关重构 |
| **测试修复** | test-driven-development | 无 | read_file, write_file, patch, terminal | workspace-write | 最多 3 轮自动修复；每轮必须记录失败原因 |
| **Diff Review** | requesting-code-review | 无 | read_file, terminal (git diff) | read-only | 检查回归/安全/并发；产出 review.md |
| **最终报告** | 无 | 无 | read_file, write_file | read-only | 聚合所有产物；产出 final-report.md |

#### 6.9.3 Skill 注入机制

Skill 加载顺序：

```
1. CapabilityRegistry 检查当前阶段声明的 skills[]
2. 对每个 skill：
   a. skill_view(name) 加载 SKILL.md
   b. 解析 YAML frontmatter（description / category / dependencies）
   c. 检查依赖 skill 是否可用（warn 而非 block）
   d. 将 SKILL.md 内容拼接进 agent system prompt 的 "Skills" 段落
   e. 加载 linked_files（references/ templates/ scripts/）到 workspace
3. 所有 skill 注入完成后，拼接 promptTemplate
4. 拼接 Tool Registry 白名单描述
5. 最终 prompt 交给 AgentRuntime.run()
```

注入格式示例（拼接到 system prompt 尾部）：

```text
═══ ACTIVE SKILLS ═══

[skill: code-graphing]
Use when indexing codebases, finding callers/callees, analyzing impact.
[content of SKILL.md...]

[skill: test-driven-development]
Enforce RED-GREEN-REFACTOR cycle, tests before code.
[content of SKILL.md...]

═══ TOOL ALLOWLIST ═══

Native: read_file, write_file, patch, terminal (limited)
MCP: codegraph_context, codegraph_callers, codegraph_impact
Skills: code-graphing, test-driven-development

═══ SANDBOX: workspace-write ═══

禁止：修改 .git/, 安装依赖, 推送远端, 创建 PR
```

#### 6.9.4 MCP 工具调用的约束策略

MCP 工具调用和 Native Tool 一样受 Tool Registry 管控，但额外需要：

- **启动策略**：stage 开始时启动该阶段声明的 MCP Server；stage 结束时关闭。
- **健康检查**：启动后 ping 一次，失败则根据 required 标记决定是否 blocked。
- **超时策略**：单个 MCP 工具调用超时不超过 AgentRuntime 的 maxToolCallsPerRun 限制。
- **降级策略**：optional MCP 不可用时，记录 warn 并 fallback 到 Native Tools（如 search_files 替代 codegraph_context）。
- **凭证隔离**：MCP Server 的 env 由平台注入，不通过 agent prompt 暴露。

#### 6.9.5 执行约束的强制执行点

约束不在 prompt 里"说说而已"，必须在代码层 enforce：

| 约束 | 执行点 |
|---|---|
| 工具白名单 | AgentRuntime.run() 调用前过滤 tool list |
| 沙箱级别 | write_file / terminal 调用前检查 sandbox policy |
| 敏感操作 | 拦截并 require explicit approval signal |
| maxAgentRuns | Workflow for 循环计数器 |
| maxToolCallsPerRun | AgentRuntime 代理层计数拦截 |
| maxDurationMs | Temporal Activity heartbeat 超时 |
| requireOutputFile | Activity 返回前校验文件存在 |
| validateOutputSchema | Activity 返回前 JSON Schema 校验 |

约束违反时的行为：

- 工具白名单违反：agent 调用未授权工具时，返回 "Tool not available in this stage"。
- 沙箱违反：写操作被拒绝，记录 error 事件，stage 进入 blocked。
- 超时：Temporal 自动 cancel activity，stage 进入 failed 或 retry。
- Schema 校验失败：stage 标记 failed_needs_human，交给人工审查。

#### 6.9.6 阶段产物验证

每个阶段的输出产物必须经过验证才能进入下一阶段：

```ts
async function validateStageOutput(stage: string, manifest: StageCapabilityManifest): Promise<ValidationResult> {
  for (const output of manifest.outputs) {
    // 1. 文件存在性
    if (output.required && !fileExists(output.path)) {
      return { passed: false, reason: `Missing required output: ${output.path}` };
    }

    // 2. Schema 校验
    if (output.schema) {
      const data = readJSON(output.path);
      const valid = validateAgainstSchema(data, output.schema);
      if (!valid) {
        return { passed: false, reason: `Schema validation failed for ${output.path}` };
      }
    }

    // 3. 内容非空检查
    if (fileSize(output.path) < 50) {
      return { passed: false, reason: `Output ${output.path} appears too small (possible empty/truncated)` };
    }
  }
  return { passed: true };
}
```

## 7. 长任务流程

### 7.0 阶段执行协议（每个阶段通用）

每个阶段的执行遵循统一协议，不再各自为战：

```text
1. loadManifest(stage)          → 获取 StageCapabilityManifest
2. startMCPServers(manifest)    → 按需启动 MCP Server，健康检查
3. loadSkills(manifest.skills)  → 注入 SKILL.md + linked_files
4. buildPrompt(template, context) → 拼接 prompt + tool allowlist + sandbox policy
5. agentRun(prompt, tools)      → 执行 agent，受约束拦截
6. validateOutput(manifest)     → 校验产物（存在性 + schema + 非空）
7. stopMCPServers(manifest)     → 关闭本阶段 MCP Server
8. recordEvent(stage, result)   → 写入事件流
```

任何一步失败，stage 进入 blocked / failed，不继续执行后续阶段。

### 7.1 输入任务

输入来源：

- 用户输入。
- Issue。
- PRD。
- 需求文档。
- IM 对话。
- Bug report。

标准输入：

```json
{
  "task_id": "TASK-123",
  "repo": "git@example.com:team/project.git",
  "base_branch": "main",
  "requirement_source": "docs/input.md",
  "mode": "implementation",
  "approval_policy": "requirements_and_plan",
  "test_policy": "unit_tests_required"
}
```

### 7.2 需求提取

Agent 输出：

```text
背景
目标
非目标
功能需求
非功能需求
约束
验收标准
开放问题
```

如果存在开放问题，应进入 `needs_input` 状态，而不是继续编码。

### 7.3 需求理解审批

人工确认：

```text
需求理解是否正确？
验收标准是否明确？
是否允许进入代码分析？
```

### 7.4 CodeGraph 代码影响分析

要求：

- 结构性问题优先使用 CodeGraph。
- 不用 grep 替代调用链分析。
- 如果没有 `.codegraph/`，任务进入 `blocked_codegraph_not_initialized`。

分析内容：

```text
相关入口
关键类/函数
调用方
被调用依赖
影响模块
测试覆盖点
高风险改造点
```

### 7.5 改造计划

计划必须具体到文件和步骤：

```text
改哪些文件
为什么改
怎么改
如何验证
有哪些风险
如何回滚
```

### 7.6 计划审批

人工确认：

```text
是否同意该改造范围？
是否同意测试策略？
是否允许创建分支并开始编码？
```

### 7.7 创建 branch / worktree

规则：

- 每个任务一个独立 branch 或 worktree。
- 多任务并行时优先使用 worktree。
- 不在脏工作区直接改代码。

### 7.8 编写测试

原则：

- 能先写测试就先写测试。
- 对既有代码不强行大改测试结构。
- 至少覆盖验收标准和失败路径。

### 7.9 编码

要求：

- 严格按计划修改。
- 不做无关重构。
- 不引入不必要依赖。
- 每次 agent run 保存 diff 和摘要。

### 7.10 测试与修复循环

流程：

```text
run tests
  -> passed -> review
  -> failed -> root cause analysis
  -> smallest fix
  -> rerun tests
```

最大自动修复次数建议：

```text
3
```

超过次数：

```text
tests_failed_needs_human
```

### 7.11 Review

Review agent 检查：

- correctness。
- 回归风险。
- 测试缺口。
- 安全风险。
- 并发/事务/边界问题。

### 7.12 最终报告

报告必须包含：

```text
任务摘要
需求摘要
修改文件
关键实现点
测试命令
测试结果
失败与修复记录
剩余风险
后续建议
```

## 8. Temporal Workflow 设计

### 8.1 Workflow 主体（集成 Capability Binding）

```ts
export async function LongEngineeringTaskWorkflow(input: TaskInput) {
  const task = await activities.createTaskWorkspace(input);

  // Phase 1: Requirements
  const requirements = await runStage(task, "normalize_requirements");
  await waitForApproval("requirements", requirements);

  const requirementAnalysis = await runStage(task, "analyze_requirements");
  const impact = await runStage(task, "codegraph_impact");

  const plan = await runStage(task, "write_implementation_plan", {
    requirementAnalysis, impact
  });
  await waitForApproval("plan", plan);

  // Phase 2: Implementation
  await activities.createWorktree(task);
  await runStage(task, "write_tests");
  await runStage(task, "implement_code");

  // Phase 3: Test & Fix
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await activities.runTests(task);

    if (result.passed) {
      break;
    }

    await runStage(task, "fix_test_failures", { testResult: result, attempt });
  }

  // Phase 4: Review & Report
  await runStage(task, "review_diff");
  await runStage(task, "publish_final_report");

  return { status: "completed", taskId: task.id };
}

/**
 * 通用阶段执行器：封装 7.0 协议的 8 步
 */
async function runStage(
  task: Task,
  stageName: string,
  context?: Record<string, unknown>
) {
  const manifest = loadManifest(stageName);

  // 1. 按需启动 MCP
  await startMCPServers(task, manifest);

  try {
    // 2-3. 注入 Skills + 构建 Prompt
    const prompt = buildPrompt(task, manifest, context);

    // 4-5. Agent Run（受 tool allowlist + sandbox 约束）
    const runResult = await agentRuntime.run({
      taskId: task.id,
      stage: stageName,
      cwd: task.worktreePath,
      prompt,
      tools: resolveAllowedTools(manifest),
      sandbox: manifest.sandbox,
      outputSchema: resolveOutputSchema(manifest),
    });

    if (runResult.status === "failed") {
      throw new StageError(stageName, runResult.error?.message);
    }

    // 6. 产物校验
    const validation = await validateStageOutput(stageName, manifest);
    if (!validation.passed) {
      throw new StageError(stageName, validation.reason);
    }

    return loadOutputArtifacts(manifest);
  } finally {
    // 7. 清理 MCP
    await stopMCPServers(manifest);
  }

  // 8. 事件记录由 Temporal Activity 自动处理
}
```

### 8.2 Activity 与 Signal 关系

Temporal Signal 用于人工审批和外部控制：

```ts
// Signal handlers
export function handleApprovalSignal(signal: ApprovalSignal) {
  approvalState.set(signal.stage, signal.decision);
}

// waitForApproval 实现
async function waitForApproval(stage: string, content: unknown): Promise<void> {
  await condition(() => {
    const decision = approvalState.get(stage);
    if (decision === "rejected") {
      throw new StageError(stage, `Approval rejected: ${decision.comment}`);
    }
    return decision === "approved";
  }, TIMEOUT_7_DAYS);
}
```

Workflow 重启后从 last completed Activity 自动恢复（Temporal 保证）。

## 9. Pi Agent 二开代码结构建议

```text
apps/pi-agent-platform/
  src/
    api/
      task-routes.ts
      approval-routes.ts
      event-routes.ts
    workflows/
      LongEngineeringTaskWorkflow.ts
    activities/
      agent-activities.ts
      git-activities.ts
      test-activities.ts
      artifact-activities.ts
      report-activities.ts
    agent-runtimes/
      AgentRuntime.ts
      PiAgentRuntime.ts
      PiInlineRuntime.ts
      HermesRuntime.ts
      MockRuntime.ts
      CodexRuntime.ts  # optional after MVP
    tools/
      ToolRegistry.ts
      CodeGraphAdapter.ts
      GitAdapter.ts
      TestCommandResolver.ts
    capability/
      CapabilityRegistry.ts
      StageCapabilityManifest.ts
      MCPServerManager.ts
      SkillLoader.ts
      StageEnforcer.ts
      OutputValidator.ts
      manifests/
        normalize-requirements.json
        analyze-requirements.json
        codegraph-impact.json
        write-implementation-plan.json
        write-tests.json
        implement-code.json
        fix-test-failures.json
        review-diff.json
        publish-final-report.json
    workspace/
      WorkspaceManager.ts
      WorktreeManager.ts
    artifacts/
      ArtifactStore.ts
      LocalArtifactStore.ts
      S3ArtifactStore.ts
    domain/
      Task.ts
      Stage.ts
      Approval.ts
      AgentRun.ts
      TestRun.ts
    schemas/
      requirements.schema.json
      impact.schema.json
      test-result.schema.json
      final-report.schema.json
```

## 10. 数据模型

### 10.1 Task

```ts
interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  repo: string;
  baseBranch: string;
  worktreePath?: string;
  artifactRoot: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

### 10.2 Stage

```ts
interface Stage {
  taskId: string;
  name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "blocked";
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  outputArtifacts: string[];
}
```

### 10.3 AgentRun

```ts
interface AgentRun {
  id: string;
  taskId: string;
  stage: string;
  runtime: "codex" | "pi-inline" | "hermes" | "mock";
  model?: string;
  sandbox: "read-only" | "workspace-write" | "full-access";
  promptFile: string;
  outputFile?: string;
  logFile: string;
  status: "succeeded" | "failed" | "needs_input";
}
```

### 10.4 Approval

```ts
interface Approval {
  taskId: string;
  stage: "requirements" | "plan" | "diff" | "pr";
  decision: "approved" | "rejected";
  comment?: string;
  reviewer: string;
  decidedAt: string;
}
```

## 11. Prompt 与产物规范

每个阶段使用独立 prompt 模板：

```text
prompts/
  normalize-requirements.md
  analyze-requirements.md
  codegraph-impact.md
  write-plan.md
  write-tests.md
  implement-code.md
  fix-tests.md
  review-diff.md
  final-report.md
```

每个 prompt 必须包含：

- 当前阶段目标。
- 输入文件路径。
- 输出文件路径。
- 可用工具。
- 禁止行为。
- 输出格式。
- 验收标准。

示例：

```text
你正在执行 TASK-123 的 codegraph-impact 阶段。

输入：
- docs/tasks/TASK-123/requirements.json
- docs/tasks/TASK-123/requirement-analysis.md

要求：
- 优先使用 CodeGraph 分析结构关系。
- 输出相关入口、调用链、影响面和测试建议。
- 不修改代码。

输出：
- docs/tasks/TASK-123/codegraph-impact.md
- docs/tasks/TASK-123/codegraph-impact.json
```

## 12. 权限设计

阶段权限：

```text
需求提取：read-only
需求分析：read-only
CodeGraph 分析：read-only
计划生成：read-only
测试设计：read-only 或 workspace-write
编码：workspace-write
测试：workspace-write
Git push / PR：显式审批
生产发布：不建议由 Pi Agent 直接执行
```

敏感操作：

- 删除文件。
- 安装依赖。
- 修改 CI/CD。
- 修改权限配置。
- 推送远端分支。
- 创建 PR。
- 访问生产环境。

这些操作必须有审批或策略白名单。

## 13. 可观测性

必须记录：

- Task 状态变化。
- 每次 AgentRun 的输入、输出、耗时。
- 每次工具调用摘要。
- Git diff。
- 测试命令和测试结果。
- 审批记录。
- 失败原因和重试次数。

事件流示例：

```json
{
  "task_id": "TASK-123",
  "event": "stage.completed",
  "stage": "codegraph_impact",
  "summary": "Identified 3 modules and 2 high-risk call paths.",
  "created_at": "2026-09-03T00:00:00Z"
}
```

## 14. 与现有 Pi 能力的关系

Pi 核心环境不应被假定一定有标准 subagent 或 todo 工具。二开时建议：

- 把 subagent 能力设计为可选插件。
- 如果安装了 `pi-subagents`，则启用并行 agent。
- 如果没有 subagent 工具，则由主流程串行执行。
- 如果没有 todo 工具，则使用 Markdown checklist 或任务表。

也就是说，平台层不要硬编码某个工具一定存在，而应通过 Capability Registry 判断：

```ts
interface CapabilityRegistry {
  hasSubagents(): boolean;
  hasTodoTool(): boolean;
  hasCodeGraph(): boolean;
  hasBrowserTool(): boolean;
  hasGitHubTool(): boolean;
}
```

## 15. MVP 范围

第一阶段只做最小可用闭环：

```text
输入需求
 -> 结构化需求
 -> 人工确认
 -> CodeGraph 分析
 -> 改造计划
 -> 人工确认
 -> 创建 worktree
 -> PiAgentRuntime 实现
 -> 跑测试
 -> 最多修复 3 次
 -> 输出报告
```

MVP 不做：

- 多租户。
- 复杂 Web UI。
- 自动发布。
- 多仓库事务。
- 自动合并 PR。
- 成本计费系统。
- 插件市场。

### 15.1 MVP 实施方案索引

由于主方案已经承担总体架构、边界和决策说明，MVP 的具体实施步骤拆分到独立文档中维护。主文档只保留索引，避免后续实施细节继续拉长主方案。

实施文档阅读顺序：

```text
1. mvp/README.md
2. mvp/m0-capability-binding.md
3. mvp/m1-artifacts-prompts-schemas.md
4. mvp/m2-runtime-workspace-workflow.md
```

文档职责：

| 文档 | 职责 |
| --- | --- |
| [`mvp/README.md`](mvp/README.md) | MVP 目标、技术假设、交付边界、执行顺序和验收场景 |
| [`mvp/m0-capability-binding.md`](mvp/m0-capability-binding.md) | 阶段 capability manifest、工具白名单、沙箱、MCP、Skill 和输出校验 |
| [`mvp/m1-artifacts-prompts-schemas.md`](mvp/m1-artifacts-prompts-schemas.md) | artifact 目录、JSON Schema、prompt 模板和样例产物 |
| [`mvp/m2-runtime-workspace-workflow.md`](mvp/m2-runtime-workspace-workflow.md) | AgentRuntime、MockRuntime、PiAgentRuntime、WorkspaceManager、TestRunner 和 Temporal workflow |

执行原则：

- 主方案只描述“为什么这样做”和“边界是什么”。
- MVP 文档描述“按什么顺序做、创建哪些文件、如何验收”。
- 后续如果继续拆分 API、UI 或 PR/CI 集成，应在 `mvp/` 之外新增阶段文档，不再扩写主方案正文。

## 16. 里程碑

### M0：Capability Binding 规范（新增，与 M1 并行）

交付：

- `StageCapabilityManifest` 接口定义。
- 全部 9 个阶段的 manifest JSON 文件。
- `CapabilityRegistry` 实现（tool 过滤 + sandbox enforcement）。
- `MCPServerManager` 实现（启动 / 健康检查 / 关闭）。
- `SkillLoader` 实现（加载 + 注入 + 依赖检查）。
- `OutputValidator` 实现（文件存在性 + schema 校验）。

验收：

- 给定一个 stage name，能完整执行 7.0 协议的 8 步协议。
- 未授权工具调用被拦截，sandbox 违反被记录。
- MCP Server 按需启动关闭，无残留进程。

### M1：任务产物规范

交付：

- 任务目录结构。
- 需求 schema。
- 影响分析 schema。
- 测试报告 schema。
- Prompt 模板。

验收：

- 可以手动跑完整文档流程。

### M2：Pi Agent Runtime Adapter

交付：

- `AgentRuntime` 接口。
- `PiAgentRuntime` 实现。
- JSON 输出解析。
- 日志采集。

验收：

- 可以从程序调用本机 Pi Agent 完成需求提取和计划生成。

### M3：Workspace Manager

交付：

- Git clone / checkout。
- worktree 创建。
- 分支命名。
- diff 采集。

验收：

- 每个任务能在独立 workspace 中运行。

### M4：Temporal Workflow

交付：

- 主 Workflow。
- Activity。
- 审批 Signal。
- 失败重试。

验收：

- Worker 重启后任务可继续。

### M5：测试与报告闭环

交付：

- Test Runner。
- 测试失败修复循环。
- final-report 生成。

验收：

- 可以完成一次从需求到测试报告的端到端任务。

### M6：平台 API

交付：

- 创建任务 API。
- 查询任务 API。
- 审批 API。
- 事件流 API。

验收：

- 前端或 CLI 可以驱动完整流程。

## 17. 风险与对策

### 17.1 Agent 输出不可控

对策：

- 使用 output schema。
- 每阶段独立 prompt。
- 关键阶段人工审批。
- 保留原始日志和最终结构化结果。

### 17.2 代码改动越界

对策：

- 编码前必须有计划。
- workspace-write 只在编码阶段开启。
- diff review 检查无关文件。
- 大改动拆分任务。

### 17.3 CodeGraph 不可用

对策：

- 任务启动前检查 `.codegraph/`。
- 没有索引则进入 blocked。
- 提供初始化指令 `codegraph init -i`。

### 17.4 测试环境不稳定

对策：

- 区分环境失败和代码失败。
- 保存完整测试日志。
- flaky 测试单独标记。
- 超过重试次数交给人工。

### 17.5 并发写冲突

对策：

- 每任务独立 worktree。
- 每个代码区域同一时间只允许一个实现 agent 写。
- 并行只用于读取、分析、review 和测试设计。

## 18. Extension 与 Fork 边界评估

### 18.1 总体判断

结合本方案的目标，大部分能力应通过 extension 和外部 worker 实现。Fork 只应作为补齐 Pi Agent 底层扩展点的手段，而不是承载长任务业务逻辑。

推荐边界：

```text
Extension：任务入口、交互、状态展示、审批、报告查看。
External Worker：Temporal、Git worktree、PiAgentRuntime、Test Runner、Artifact Store。
Thin Fork：仅当 Pi Agent 缺少必要扩展点时，用来补 hook、tool registry、permission、event stream。
```

### 18.2 Extension 就可以实现的能力

| 需求 | 建议实现方式 |
| --- | --- |
| 需求提取与格式化转换 | Extension 提供命令或入口，调用后端 Task API 或 AgentRuntime 输出 `requirements.md/json` |
| 阅读与理解需求 | Extension 触发需求理解阶段，产物写入任务目录或 Artifact Store |
| 输出改造计划 | Extension 触发计划生成阶段，展示 `implementation-plan.md` |
| 输出测试用例 | Extension 触发测试设计阶段，展示 `test-cases.md` |
| 输出测试报告 | Extension 聚合或读取后端生成的 `test-report.md` |
| 任务入口 | Extension 增加 `Start Long Task` 命令、菜单或任务面板 |
| 状态展示 | Extension 查询 Temporal task 状态并展示阶段进度 |
| 人工审批 | Extension 提供 approve / reject UI，调用 Approval API |
| CodeGraph 分析入口 | Extension 触发 CodeGraph 分析；实际分析可由 worker 或 agent runtime 执行 |
| 调 Temporal | Extension 只负责创建任务、查询任务、提交审批，不直接承载 Workflow |

这些能力属于业务交互层，不需要 fork Pi Agent core。

### 18.3 更适合放外部服务的能力

| 能力 | 原因 |
| --- | --- |
| Temporal Workflow / Worker | 长任务状态、重试、恢复不应依赖 Pi Agent 客户端进程生命周期 |
| Git worktree 管理 | 需要稳定文件系统、Git 状态控制和冲突处理 |
| PiAgentRuntime 调用 | 应作为独立 runtime adapter，便于替换 Hermes、Codex 或 Pi inline runtime |
| Test Runner | 测试耗时长、日志大、环境复杂，适合 worker 管理 |
| Artifact Store | 需求、计划、diff、日志、报告需要持久化和审计 |
| PR / CI 集成 | 属于平台集成能力，不应绑死在客户端 extension |

Extension 更像控制台和操作入口，External Worker 才是长任务执行引擎。

### 18.4 可能需要 Fork 的能力

只有 extension API 做不到以下能力时，才考虑 fork：

| 能力 | Fork 条件 |
| --- | --- |
| Agent lifecycle hook | Extension 无法监听 agent run start/end、tool call、file edit、error、cancel |
| Tool Registry | Extension 无法注册自定义工具、MCP 或 CodeGraph 工具 |
| Permission / Sandbox 控制 | Extension 无法按阶段切换 read-only、workspace-write、full-access |
| Context 注入 | Extension 无法在每次 agent run 前注入任务上下文、AGENTS 规则、产物路径 |
| Streaming Events | Extension 无法拿到 agent 流式事件，导致任务状态不可观测 |
| Subagent / Parallel Agent | Extension 无法启动、恢复、管理子 agent |
| Workspace Binding | Extension 无法控制当前 workspace、worktree、branch |
| Patch / File Operation Interception | Extension 无法审计或阻止越权文件修改 |
| UI 扩展能力不足 | Extension 无法提供任务面板、审批面板、报告视图 |

Fork 的目标应是补平台扩展点，而不是把业务逻辑塞进 core。

### 18.5 推荐拆分

```text
pi-long-task-extension
  - 任务入口
  - 状态面板
  - 审批按钮
  - 报告查看
  - 调用 Task API

pi-task-platform
  - Temporal Worker
  - AgentRuntime Adapter
  - CodeGraph Adapter
  - Git Worktree Manager
  - Test Runner
  - Artifact Store

pi-agent-thin-fork，可选
  - lifecycle hooks
  - tool registry hooks
  - permission hooks
  - context injection hooks
  - event stream hooks
```

### 18.6 决策规则

```text
如果 extension 能注册命令、UI、工具、MCP、上下文和事件监听：
  只做 extension + external worker。

如果 extension 能力不够，但 core 结构稳定：
  做 thin fork 补扩展点，业务仍放 extension / worker。

如果 Pi Agent 完全没有 extension 机制：
  fork 一次，优先改造成 extension-first 架构。
```

### 18.7 结论

结合当前需求，预估分布：

```text
80%：Extension + 外部服务实现。
15%：External Worker / Platform 能力。
5% - 10%：可能需要 Thin Fork，取决于 Pi Agent extension API 成熟度。
```

建议先做 extension POC，验证四个关键点：

- 能否注册工具和 MCP。
- 能否监听 agent 生命周期事件。
- 能否注入任务上下文。
- 能否按阶段控制权限。

这四项全部满足，就不 fork。任何一项无法满足，再考虑 thin fork。

## 19. 最终推荐

如果目标是快速验证：

```text
Pi Agent + Markdown 任务目录 + CodeGraph + 手动 branch
```

如果目标是团队可用：

```text
Pi Agent + Temporal + PiAgentRuntime + CodeGraph + Git worktree + Artifact Store
```

如果目标是平台化：

```text
Pi Agent Platform + Temporal + 多 Runtime Adapter + Tool Registry + Approval Service + Observability + PR/CI 集成
```

推荐从第二条开始做。它的工程投入可控，同时能解决长任务最核心的问题：状态可靠、过程可审计、失败可恢复、代码变更可隔离。

最终一句话：

```text
Pi Agent 二开不要先做“大而全智能体”，先做“可靠的工程长任务执行平台”。
```
